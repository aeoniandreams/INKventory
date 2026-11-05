// 관리자 비밀번호 설정 (해시만 저장, 평문 비밀번호는 저장하지 않음)
// 비밀번호를 설정/변경하려면: python tools/set_admin_password.py
window.INKVENTORY_CONFIG = {
  admin: { salt: '', hash: '', iterations: 200000 },
};
