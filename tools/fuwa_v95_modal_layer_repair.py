from pathlib import Path


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 match, found {count}")
    return text.replace(old, new, 1)


style_path = Path("style.css")
style = style_path.read_text(encoding="utf-8")
style = replace_once(
    style,
    '''.cloud-restore-modal {
  position: fixed;
  inset: 0;
  z-index: 170;''',
    '''.cloud-restore-modal {
  position: fixed;
  inset: 0;
  /* Data-safety dialogs must stay above optional check-in sheets, but below privacy lock. */
  z-index: 360;''',
    "cloud restore modal stacking",
)
style_path.write_text(style, encoding="utf-8")

index_path = Path("index.html")
index = index_path.read_text(encoding="utf-8")
index = replace_once(
    index,
    'A small cloud-restore reliability update: Restore safely can no longer get stuck disabled after a slow or temporary cloud check, while duplicate taps stay blocked during a real restore.',
    'A small cloud-restore reliability update: Restore safely stays retryable after temporary cloud checks, and the restore sheet now stays above regular check-in sheets so nothing invisible can block your tap.',
    "v95 release lead layering note",
)
index_path.write_text(index, encoding="utf-8")

print("Fuwa v95 modal layering repair applied.")
