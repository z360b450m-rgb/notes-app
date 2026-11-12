from src.db_sql.agent import agent

print("start")
print("agent loaded")

result = agent.invoke(
    {
        "messages": [
            {"role": "user", "content": "Help me find mistake entries about hash maps."}
        ]
    }
)


messages = result["messages"]
final_message = messages[-1]
print("done")
print(result["messages"])
