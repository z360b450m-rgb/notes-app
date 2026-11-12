"""Browser account/cache isolation against a mocked API; no live data writes."""

import json
import os
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from urllib.parse import urlparse

from playwright.sync_api import expect, sync_playwright


def run():
    class QuietHandler(SimpleHTTPRequestHandler):
        def log_message(self, *_args):
            pass

    dist = Path(__file__).resolve().parents[2] / "dist"
    assert (dist / "index.html").exists(), "Run npm run build first"
    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietHandler, directory=str(dist)))
    Thread(target=server.serve_forever, daemon=True).start()
    users = {
        name: {"id": name, "email": name + "@example.test", "full_name": name,
               "is_active": True, "created_at": 1}
        for name in ("alice", "bob")
    }
    notebooks = {
        name: {"id": name + "-nb", "user_id": name, "name": name + " notebook",
               "description": "", "instructions": "", "created_at": 1, "updated_at": 1}
        for name in users
    }
    writes = []

    def api(route):
        request = route.request
        owner = request.headers.get("authorization", "").removeprefix("Bearer ").removesuffix("-token")
        path = urlparse(request.url).path
        result = {"status": "ok"}
        if path == "/api/users/me":
            result = users[owner]
        elif path == "/api/notebooks" and request.method == "GET":
            result = {"items": [notebooks[owner]]}
        elif request.method in ("POST", "PATCH", "DELETE"):
            writes.append((owner, path, request.post_data_json))
        else:
            result = {"items": []}
        route.fulfill(status=200, content_type="application/json", body=json.dumps(result))

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True, channel=os.getenv("PLAYWRIGHT_CHANNEL"))
        try:
            context = browser.new_context()
            context.route("http://localhost:8000/**", api)
            page = context.new_page()
            page.goto(f"http://127.0.0.1:{server.server_port}/", wait_until="domcontentloaded")
            page.evaluate("""async (notebooks) => {
              const db = await new Promise((resolve, reject) => {
                const r = indexedDB.open('CuotiDB', 6);
                r.onupgradeneeded = () => {
                  const d = r.result;
                  for (const [name, keyPath] of [['notebooks','id'],['entries','id'],
                    ['questionGroups','id'],['snapshots','entryId'],['reviewLogs','id']])
                    d.createObjectStore(name, {keyPath});
                };
                r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
              });
              await new Promise((resolve, reject) => {
                const tx = db.transaction(['notebooks','entries','snapshots','reviewLogs'],'readwrite');
                for (const owner of ['alice','bob']) {
                  const nb = {...notebooks[owner], createdAt: 1, updatedAt: 1};
                  const entry = {id: owner+'-entry',notebookId:nb.id,title:owner+' secret',
                    question:'question',wrongAnswer:'',correctAnswer:'',subject:'',source:'',
                    tags:[],createdAt:1,updatedAt:1};
                  tx.objectStore('notebooks').put(nb); tx.objectStore('entries').put(entry);
                  tx.objectStore('snapshots').put({entryId:entry.id,data:entry,savedAt:1});
                  tx.objectStore('reviewLogs').put({id:owner+'-log',entryId:entry.id,timestamp:1,quality:'good'});
                }
                tx.oncomplete=resolve; tx.onerror=()=>reject(tx.error);
              }); db.close();
              localStorage.setItem('offline_pending_sync_queue_v1', JSON.stringify(
                ['alice','bob'].map(owner=>({id:'notebook:'+owner+'-nb',action:'put_notebook',
                  payload:{...notebooks[owner],createdAt:1,updatedAt:1},timestamp:1}))));
            }""", notebooks)

            for owner in users:
                page.evaluate("""({owner,user}) => {
                  localStorage.setItem('notes_app_access_token',owner+'-token');
                  localStorage.setItem('notes_app_current_user',JSON.stringify(user));
                }""", {"owner": owner, "user": users[owner]})
                page.reload(wait_until="domcontentloaded")
                expect(page.get_by_text(owner + " notebook", exact=True).first).to_be_visible()
                other = "bob" if owner == "alice" else "alice"
                expect(page.get_by_text(other + " notebook", exact=True)).to_have_count(0)
                page.wait_for_function("""owner => localStorage.getItem('CuotiDB:'+owner+':legacy-migrated')==='true'""", arg=owner)
                cache = page.evaluate("""async owner => {
                  const r=indexedDB.open('CuotiDB:'+owner,7);
                  const db=await new Promise(resolve=>{r.onsuccess=()=>resolve(r.result)});
                  const result={};
                  for(const store of ['notebooks','entries','snapshots','reviewLogs']) {
                    result[store]=await new Promise(resolve=>{
                      const q=db.transaction(store).objectStore(store).getAll();
                      q.onsuccess=()=>resolve(q.result);
                    });
                  } db.close(); return result;
                }""", owner)
                assert [item["id"] for item in cache["notebooks"]] == [owner + "-nb"]
                assert [item["id"] for item in cache["entries"]] == [owner + "-entry"]
                assert [item["entryId"] for item in cache["snapshots"]] == [owner + "-entry"]
                assert [item["entryId"] for item in cache["reviewLogs"]] == [owner + "-entry"]
            assert writes, "Expected migrated offline queue to flush"
            assert all(owner in path for owner, path, _ in writes), writes
            print("PASS: account switching, notebook visibility, legacy cache/snapshots/logs and per-user queue migration")
        finally:
            browser.close()
            server.shutdown()
            server.server_close()


if __name__ == "__main__":
    run()
