"""Exdiary 统一异常类。"""


class ExdiaryError(Exception):
    pass


class ExtractionError(ExdiaryError):
    pass


class StorageError(ExdiaryError):
    pass


class AgentError(ExdiaryError):
    pass


class ConfigurationError(ExdiaryError):
    pass
