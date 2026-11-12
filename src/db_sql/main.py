from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.db_sql.routers import auth, entries, notebooks, question_groups, review_logs, review_agent, learning_stats, notebook_index, review_candidates
from src.db_sql.routers import review_insights, review_attempts, review_bundles
from src.db_sql.routers import pdf_question_imports
from src.db_sql.routers import knowledge_documents
from src.db_sql.routers import image_ocr


app = FastAPI(title="Notes MySQL Backend API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", tags=["base"])
def health_check():
    return {"status": "ok", "message": "Python MySQL backend is running"}


app.include_router(notebooks.router)
app.include_router(entries.router)
app.include_router(question_groups.router)
app.include_router(review_logs.router)
app.include_router(auth.router)
app.include_router(review_agent.router)
app.include_router(learning_stats.router)
app.include_router(review_candidates.router)
app.include_router(review_insights.router)
app.include_router(review_attempts.router)
app.include_router(review_bundles.router)
app.include_router(notebook_index.router)
app.include_router(pdf_question_imports.router)
app.include_router(knowledge_documents.router)
app.include_router(image_ocr.router)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("src.db_sql.main:app", host="127.0.0.1", port=8000, reload=True)
