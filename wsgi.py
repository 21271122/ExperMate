"""WSGI 部署入口：单进程、多线程；运行数据目录由进程环境指定。"""
from app import create_app

application = create_app()
