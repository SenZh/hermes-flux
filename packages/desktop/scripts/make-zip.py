#!/usr/bin/env python3
import os
import sys
import time
import zipfile

def make_portable_zip(src_dir, dest_zip):
    if not os.path.isdir(src_dir):
        print(f"Error: source directory '{src_dir}' does not exist.")
        sys.exit(1)

    os.makedirs(os.path.dirname(os.path.abspath(dest_zip)), exist_ok=True)
    start = time.time()
    print(f"[Compressor] Archiving '{src_dir}' into '{dest_zip}'...")

    with zipfile.ZipFile(dest_zip, 'w', zipfile.ZIP_DEFLATED, compresslevel=4) as zf:
        for root, dirs, files in os.walk(src_dir):
            for f in files:
                full_path = os.path.join(root, f)
                rel_path = os.path.relpath(full_path, src_dir)
                zf.write(full_path, arcname=os.path.join('Hermes-Aura-win-x64', rel_path))

    size_mb = os.path.getsize(dest_zip) / (1024 * 1024)
    duration = time.time() - start
    print(f"✔ Successfully created portable green package: {dest_zip}")
    print(f"  Package size: {size_mb:.2f} MB | Duration: {duration:.2f}s")

if __name__ == '__main__':
    if len(sys.argv) < 3:
        print("Usage: make-zip.py <source_dir> <output_zip>")
        sys.exit(1)
    make_portable_zip(sys.argv[1], sys.argv[2])
