# Adapters

Every third-party integration sits behind an interface with a **mock** implementation, so the whole app
runs with `MOCK_MODE=true` and no paid accounts. Real implementations are added once the founder has
signed the vendor's terms (permissible use, data licensing).

| Adapter | Interface | Mock | Real candidates (founder decides) |
|---------|-----------|------|-----------------------------------|
| `death-records/` | `DeathRecordSource.search()` | Fictional demo obituaries | Licensed obituary data (e.g. Berwyn Group), NTIS Limited Access Death Master File (requires certification under 15 CFR 1110) |
| `people-search/` | `PeopleSearchProvider.lookup()` | Fictional contact details | Licensed skip-tracing vendors with GLBA/DPPA permissible-use terms (e.g. TLOxp, Accurint, idiCORE) |
| mail, email, e-sign, payments | Phases 4–6 | | |

Rules for every real adapter: no scraping of sites whose terms forbid it, record the source of every
result, and use results only to locate heirs for the specific case (COMPLIANCE.md rule 9).
