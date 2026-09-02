import os
from contextlib import contextmanager

import psycopg
from pgvector.psycopg import register_vector


@contextmanager
def get_db_connection():
    conn = psycopg.connect(os.environ["DATABASE_URL"])
    try:
        register_vector(conn)
        yield conn
    finally:
        conn.close()
