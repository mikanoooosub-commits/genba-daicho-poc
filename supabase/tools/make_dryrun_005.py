"""migration_005_buildings_units.sql の本体から migration_005_dryrun.sql を作り直す。

本体(begin; と commit; の間)を写し、tools/dryrun_checks_005.sql(件数と権限の確認表 + rollback;)を付ける。
本番用の本体を直したら、これを実行して dryrun を作り直す。
"""
from pathlib import Path

base = Path(__file__).resolve().parent.parent
main = (base / "migration_005_buildings_units.sql").read_text(encoding="utf-8")
checks = (base / "tools" / "dryrun_checks_005.sql").read_text(encoding="utf-8")
dry_path = base / "migration_005_dryrun.sql"

header = (
    "-- ============================================================================\n"
    "-- migration_005_dryrun.sql — 予行演習用(WO-011 段階1・D82・D84)\n"
    "--   migration_005_buildings_units.sql の本体を流し、件数と権限を確かめて、最後に rollback する。\n"
    "--   何も残らない(テーブルも移行データも消える)。先にこれを流し、ok が全部 true なら\n"
    "--   migration_005_buildings_units.sql(本番用)を流す。\n"
    "--   このファイルは本番用から作った写し。本番用の本体を直したら作り直す:\n"
    "--     python supabase/tools/make_dryrun_005.py\n"
    "-- ============================================================================\n\nbegin;\n"
)
body = main.split("begin;\n", 1)[1].split("commit;")[0]
dry_path.write_text(header + body + checks, encoding="utf-8")
print("wrote", dry_path)
