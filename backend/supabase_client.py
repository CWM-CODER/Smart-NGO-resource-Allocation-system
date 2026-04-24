import os
from pathlib import Path
from dotenv import load_dotenv
from supabase import create_client, Client

# Load .env from the backend directory (works regardless of CWD)
_env_path = Path(__file__).parent / ".env"
load_dotenv(dotenv_path=_env_path, override=True)

_client: Client | None = None


def get_client() -> Client:
    global _client
    if _client is None:
        url = os.getenv("SUPABASE_URL", "")
        key = os.getenv("SUPABASE_SERVICE_KEY", "")
        if not url or not key:
            raise RuntimeError(
                "SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in "
                f"{_env_path}  (file exists: {_env_path.exists()})"
            )
        _client = create_client(url, key)
    return _client


# ── Problems ──────────────────────────────────────────────────
def fetch_all_problems(status_filter: list[str] | None = None) -> list[dict]:
    db = get_client()
    q = db.table("problems").select("*").order("created_at", desc=False)
    if status_filter:
        q = q.in_("status", status_filter)
    return q.execute().data or []


def fetch_problem(problem_id: str) -> dict | None:
    db = get_client()
    r = db.table("problems").select("*").eq("id", problem_id).single().execute()
    return r.data


def update_problem(problem_id: str, payload: dict) -> dict:
    db = get_client()
    r = db.table("problems").update(payload).eq("id", problem_id).execute()
    return r.data[0] if r.data else {}


def insert_problem(payload: dict) -> dict:
    db = get_client()
    r = db.table("problems").insert(payload).execute()
    return r.data[0] if r.data else {}


# ── NGOs ──────────────────────────────────────────────────────
def fetch_all_ngos() -> list[dict]:
    db = get_client()
    return db.table("ngos").select("*").order("created_at", desc=False).execute().data or []


def fetch_ngo(ngo_id: str) -> dict | None:
    db = get_client()
    r = db.table("ngos").select("*").eq("id", ngo_id).single().execute()
    return r.data


def update_ngo(ngo_id: str, payload: dict) -> dict:
    db = get_client()
    r = db.table("ngos").update(payload).eq("id", ngo_id).execute()
    return r.data[0] if r.data else {}


def insert_ngo(payload: dict) -> dict:
    db = get_client()
    r = db.table("ngos").insert(payload).execute()
    return r.data[0] if r.data else {}


# ── Assignments ───────────────────────────────────────────────
def insert_assignment(payload: dict) -> dict:
    db = get_client()
    r = db.table("assignments").insert(payload).execute()
    return r.data[0] if r.data else {}


def update_assignment(assignment_id: str, payload: dict) -> dict:
    db = get_client()
    r = db.table("assignments").update(payload).eq("id", assignment_id).execute()
    return r.data[0] if r.data else {}


def fetch_active_assignment(ngo_id: str) -> dict | None:
    db = get_client()
    r = (db.table("assignments")
         .select("*")
         .eq("ngo_id", ngo_id)
         .eq("status", "active")
         .order("started_at", desc=True)
         .limit(1)
         .execute())
    return r.data[0] if r.data else None


def fetch_ngo_history(ngo_id: str) -> list[dict]:
    db = get_client()
    r = (db.table("assignments")
         .select("*, problems:problem_id(type, description, people_affected)")
         .eq("ngo_id", ngo_id)
         .order("started_at", desc=True)
         .execute())
    return r.data or []
