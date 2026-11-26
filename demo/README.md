# Demo files (FICTIONAL)

`sample-nevada-export.csv` is an invented Nevada-style unclaimed-property export for trying the import flow.
Every name, address and holder in it is fictional. It is built to exercise each path:

| Rows | What you should see |
|------|---------------------|
| NVX-100001 / 100002 | "ESTATE OF HAROLD P WINSLOW" and "WINSLOW HAROLD P DECD" at the same address are **grouped automatically** |
| NVX-100003 / 100004 | MARGARET vs PEGGY OKAFOR in the same ZIP → **review queue** (nickname) |
| NVX-100005 / 100006 | Same name, one record has no address → **review queue** |
| NVX-100007 / 100008 | JR vs SR at the same address → kept as **separate people** |
| NVX-100009 / 100010 | Business owner and "UNKNOWN" owner → scored near zero |
| NVX-100011 | Trustee + amount range (lower bound kept, marked "≥") |
| NVX-100012 | Estate with a care-of person |
| NVX-100013 | Out-of-state last address |
| NVX-100014 / 100015 | Recently delivered → **waiting period** |
| NVX-100017 | Impossible date (02/30/2021) → **row error** |
| second NVX-100001 | Duplicate property ID → **skipped** |
| NVX-100002, 100005 | Year-only / month-only dates → end of period used, flagged approximate |
| NVX-100024 | Delivered on Feb 29 (leap day) |

Upload it at **Imports → Upload a file**; the column mapping is filled in automatically.
