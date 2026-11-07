"""The brain's storage layer: the only package that calls SQL.

`db` opens the file and runs numbered migrations; `search` holds the SQLite-only full-text
helpers. Other modules ask the store for rows and never touch the connection's SQL.
"""
