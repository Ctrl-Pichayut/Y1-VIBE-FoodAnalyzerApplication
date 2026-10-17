"""
Patch best.pt class names and re-export best.onnx with corrected names.

The model was trained with numeric string class names ("0", "1", "10", ...)
that were alphabetically sorted during training. This script:
1. Loads the model
2. Replaces numeric class names with real food names
3. Saves a patched best.pt (backs up the original first)
4. Re-exports best.onnx with the corrected names
"""
import argparse
import os
import json
import shutil
from pathlib import Path
from ultralytics import YOLO

SCRIPT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = SCRIPT_DIR.parent


def parse_args():
    parser = argparse.ArgumentParser(description="Patch YOLO .pt class names and re-export ONNX.")
    parser.add_argument(
        "--model",
        default=str(BACKEND_DIR / "models" / "best.pt"),
        help="Path to the .pt model file",
    )
    parser.add_argument(
        "--onnx",
        default=str(BACKEND_DIR / "models" / "best.onnx"),
        help="Output path for the exported .onnx model",
    )
    parser.add_argument(
        "--class-map",
        default=str(SCRIPT_DIR / "class_name_template.json"),
        help="Path to class_name_template.json or food_classes.json",
    )
    return parser.parse_args()


def main():
    args = parse_args()
    MODEL_PATH = args.model
    ONNX_PATH = args.onnx
    CLASS_MAP_PATH = args.class_map

    # Load the class name map
    with open(CLASS_MAP_PATH, 'r', encoding='utf-8') as f:
        data = json.load(f)
    class_map = data.get("class_name_map", data)

    # Load the model
    print("Loading model...", flush=True)
    model = YOLO(MODEL_PATH)
    
    # Show current names (first few)
    print(f"\nCurrent names (showing first 10):", flush=True)
    for i in range(min(10, len(model.names))):
        print(f"  {i}: {model.names[i]}", flush=True)

    # Backup original model
    backup_path = MODEL_PATH + ".backup"
    if not os.path.exists(backup_path):
        print(f"\nBacking up original model to {backup_path}...", flush=True)
        shutil.copy2(MODEL_PATH, backup_path)
    else:
        print(f"\nBackup already exists at {backup_path}", flush=True)

    # Patch the names in the model checkpoint
    import torch
    ckpt = torch.load(MODEL_PATH, map_location='cpu', weights_only=False)
    
    # The names are stored in ckpt['model'].names
    old_names = ckpt['model'].names
    new_names = {}
    for idx in range(len(old_names)):
        new_names[idx] = class_map.get(str(idx), old_names[idx])
    
    ckpt['model'].names = new_names
    
    # Save patched model
    print("\nSaving patched model...", flush=True)
    torch.save(ckpt, MODEL_PATH)
    
    # Verify the patch
    print("\nVerifying patched model...", flush=True)
    model2 = YOLO(MODEL_PATH)
    print(f"\nPatched names (showing first 10):", flush=True)
    for i in range(min(10, len(model2.names))):
        print(f"  {i}: {model2.names[i]}", flush=True)
    
    # Check no numeric names remain
    numeric_count = 0
    for idx, name in model2.names.items():
        try:
            int(name)
            numeric_count += 1
        except ValueError:
            pass
    
    if numeric_count == 0:
        print(f"\n✅ All {len(model2.names)} classes now have real food names!", flush=True)
    else:
        print(f"\n⚠️ {numeric_count} classes still have numeric names", flush=True)

    # Re-export ONNX
    print("\nExporting corrected ONNX model...", flush=True)
    model2.export(format="onnx", imgsz=640)
    
    # The export saves to the same directory as the .pt file
    exported_onnx = MODEL_PATH.replace('.pt', '.onnx')
    if os.path.exists(exported_onnx) and exported_onnx != ONNX_PATH:
        shutil.move(exported_onnx, ONNX_PATH)
    
    print(f"\n✅ Done! Files updated:", flush=True)
    print(f"   - {MODEL_PATH} (patched with real food names)", flush=True)
    print(f"   - {ONNX_PATH} (re-exported with corrected names)", flush=True)
    print(f"   - {backup_path} (original backup)", flush=True)

if __name__ == "__main__":
    main()
