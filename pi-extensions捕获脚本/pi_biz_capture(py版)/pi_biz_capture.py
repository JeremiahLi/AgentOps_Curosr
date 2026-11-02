import os
import json
import hashlib
from datetime import datetime
from pathlib import Path

SPOOL_DIR = os.environ.get('PI_BIZ_CAPTURE_SPOOL_DIR',
                           os.path.join(str(Path.home()), '.pi-biz-capture'))


def _get_user_id():
    return os.environ.get('USER') or os.environ.get('USERNAME') or 'unknown'


def _compute_project_id(cwd):
    return hashlib.sha1(cwd.encode('utf-8')).hexdigest()[:16]


def _build_out_file(user_id, project_id, session_id):
    now = datetime.now()
    day_dir = Path(SPOOL_DIR) / user_id / project_id / now.strftime('%Y-%m-%d')
    day_dir.mkdir(parents=True, exist_ok=True)
    ts = now.strftime('%H%M%S')
    return day_dir / f'biz-{session_id}-{ts}.jsonl'


class TokenTracker:
    def __init__(self):
        self._input_tokens = 0
        self._output_tokens = 0
        self._call_count = 0
        self._models = set()

    def add_call(self, input_tokens: int, output_tokens: int, model: str = "unknown"):
        self._input_tokens += input_tokens
        self._output_tokens += output_tokens
        self._call_count += 1
        self._models.add(model)

    def get_summary(self) -> dict:
        if self._call_count == 0:
            return None
        return {
            "inputTokens": self._input_tokens,
            "outputTokens": self._output_tokens,
            "totalTokens": self._input_tokens + self._output_tokens,
            "callCount": self._call_count,
            "models": sorted(self._models),
        }

    @property
    def input_tokens(self) -> int:
        return self._input_tokens

    @property
    def output_tokens(self) -> int:
        return self._output_tokens

    @property
    def total_tokens(self) -> int:
        return self._input_tokens + self._output_tokens

    @property
    def call_count(self) -> int:
        return self._call_count


def report_biz_metrics(
    agent_id: str,
    task_id: str,
    metrics: dict,
    session_id: str = None,
    project_id: str = None,
    cwd: str = None
):
    session_id = session_id or os.environ.get('PI_SESSION_ID', 'unknown')
    project_id = project_id or os.environ.get('PI_PROJECT_ID')
    cwd = cwd or os.environ.get('PI_CWD', os.getcwd())

    if not project_id and cwd:
        project_id = _compute_project_id(cwd)
    project_id = project_id or 'unknown'

    user_id = _get_user_id()
    out_file = _build_out_file(user_id, project_id, session_id)

    record = {
        't': datetime.now().isoformat(),
        'userId': user_id,
        'projectId': project_id,
        'sessionId': session_id,
        'agentId': agent_id,
        'taskId': task_id,
        'metrics': metrics
    }

    with open(out_file, 'a', encoding='utf-8') as f:
        f.write(json.dumps(record, ensure_ascii=False) + '\n')

    return str(out_file)
