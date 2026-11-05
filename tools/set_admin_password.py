"""관리자 비밀번호를 정해서 js/config.js 에 해시로 저장한다.

사용법 (프로젝트 폴더에서):
    python tools/set_admin_password.py

비밀번호는 화면에 표시되거나 셸 기록에 남지 않고, 파일에는 salt + PBKDF2 해시만 기록된다.
"""
import getpass
import hashlib
import os
import sys
from pathlib import Path

ITERATIONS = 200_000
CONFIG = Path(__file__).resolve().parent.parent / "js" / "config.js"


def make_config(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, ITERATIONS)
    return (
        "// 관리자 비밀번호 설정 (해시만 저장, 평문 비밀번호는 저장하지 않음)\n"
        "// 비밀번호를 설정/변경하려면: python tools/set_admin_password.py\n"
        "window.INKVENTORY_CONFIG = {\n"
        f"  admin: {{ salt: '{salt.hex()}', hash: '{digest.hex()}', iterations: {ITERATIONS} }},\n"
        "};\n"
    )


def main() -> None:
    pw = getpass.getpass("새 관리자 비밀번호: ")
    if len(pw) < 8:
        sys.exit("8자 이상으로 정해 주세요.")
    if pw != getpass.getpass("한 번 더 입력: "):
        sys.exit("두 비밀번호가 일치하지 않습니다.")
    CONFIG.write_text(make_config(pw), encoding="utf-8", newline="\n")
    print(f"저장했습니다: {CONFIG}")


if __name__ == "__main__":
    main()
