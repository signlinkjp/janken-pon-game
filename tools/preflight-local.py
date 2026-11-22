#!/usr/bin/env python3
"""Run the GitHub Actions preflight job locally.

ワークフロー（.github/workflows/・docs/ の写し）の preflight ジョブから
`run:` のブロックだけを取り出し、GitHub が渡す env と同じ値を入れて順に実行する。
`uses:`（checkout / setup-node）と `if:` 付きの確認入力は、ローカルでは飛ばす。

  python3 tools/preflight-local.py .github/workflows/ios-testflight-build1.yml
"""

import os
import pathlib
import subprocess
import sys
import tempfile

import yaml

ROOT = pathlib.Path(__file__).resolve().parent.parent


def main() -> int:
    workflow = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ".github/workflows/ios-testflight-build1.yml")
    doc = yaml.safe_load((ROOT / workflow).read_text(encoding="utf-8"))
    job = doc["jobs"]["preflight"]
    env = dict(doc.get("env") or {})

    # GitHub が run ごとに渡す値（workflow_dispatch の入力は既定値）
    env.setdefault("BUNDLE_ID", "jp.signlink.JankenPon")
    env.setdefault("PBXPROJ", "ios/App/App.xcodeproj/project.pbxproj")
    inputs = (doc.get(True) or doc.get("on") or {}).get("workflow_dispatch", {}).get("inputs", {}) or {}
    for name, spec in inputs.items():
        env.setdefault(name.upper(), str((spec or {}).get("default", "")))

    github_env = tempfile.NamedTemporaryFile("w+", delete=False)
    github_env.close()
    env["GITHUB_ENV"] = github_env.name
    env["PATH"] = "/workspace/.tools/node22/bin:" + os.environ.get("PATH", "/usr/bin:/bin")

    def resolve(value: str) -> str:
        """`${{ inputs.confirm_bundle_id }}` を GitHub と同じように解決する"""
        import re

        def pick(match: re.Match) -> str:
            scope, key = match.group(1), match.group(2)
            if scope == "inputs":
                return env.get(key.upper(), "")
            if scope == "env":
                return env.get(key, os.environ.get(key, ""))
            return ""

        return re.sub(r"\$\{\{\s*(inputs|env)\.([A-Za-z0-9_]+)\s*\}\}", pick, value)

    failures = []
    for step in job["steps"]:
        if "uses" in step or "run" not in step:
            continue
        name = step.get("name", "run")
        # GITHUB_ENV に書いた値を次のステップへ渡す（GitHub と同じ）
        for line in pathlib.Path(github_env.name).read_text().splitlines():
            key, _, value = line.partition("=")
            if key:
                env[key] = value
        print(f"\n=== {name} ===", flush=True)
        step_env = {**env}
        for key, value in (step.get("env") or {}).items():
            step_env[key] = resolve(str(value))
        result = subprocess.run(
            ["bash", "-e", "-c", step["run"]],
            cwd=ROOT,
            env={**os.environ, **step_env},
        )
        if result.returncode != 0:
            failures.append(name)

    pathlib.Path(github_env.name).unlink(missing_ok=True)
    if failures:
        print("\npreflight NG:", ", ".join(failures))
        return 1
    print("\npreflight OK（すべてのステップが通りました）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
