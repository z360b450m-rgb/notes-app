from dotenv import load_dotenv

from deepagents import create_deep_agent
from langchain_deepseek import ChatDeepSeek

from src.db_sql.agent_tools import search_tool

load_dotenv()

model = ChatDeepSeek(
    model="deepseek-chat",
    temperature=0,
)

#自定义工具列表 
custom_tools = [search_tool]

prompt = "你是一个错题管理助手"

#创建Agent
agent = create_deep_agent(
    model=model,
    tools= custom_tools,
    system_prompt="You are a study mistake management assistant.",
)
