
from datetime import datetime
from colormax import colormax

GOVERNORATES = {
    "01": "القاهرة", "02": "الإسكندرية", "03": "بورسعيد", "04": "السويس",
    "11": "دمياط", "12": "الدقهلية", "13": "الشرقية", "14": "القليوبية",
    "15": "كفر الشيخ", "16": "الغربية", "17": "المنوفية", "18": "البحيرة",
    "19": "الإسماعيلية", "21": "الجيزة", "22": "بني سويف", "23": "الفيوم",
    "24": "المنيا", "25": "أسيوط", "26": "سوهاج", "27": "قنا", "28": "أسوان",
    "29": "الأقصر", "31": "البحر الأحمر", "32": "الوادي الجديد", "33": "مطروح",
    "34": "شمال سيناء", "35": "جنوب سيناء", "88": "خارج الجمهورية",
}

B  = colormax["bold"]
C  = colormax["bold cyan"]
G  = colormax["bold green"]
Y  = colormax["bold yellow"]
R  = colormax["bold red"]
M  = colormax["bold magenta"]
D  = colormax["dim"]
W  = colormax["bold white"]
LINE = D("· " * 18)


def analyze(nid: str) -> str:
    nid = nid.strip()
    if len(nid) != 14 or not nid.isdigit():
        return f"\n  {R('✖')} {R('الرقم لازم 14 رقم بدون حروف.')}\n"

    c = nid[0]
    if c == "2":
        base = 1900
    elif c == "3":
        base = 2000
    else:
        return f"\n  {R('✖')} {R('الرقم الأول لازم 2 أو 3.')}\n"

    year, month, day = base + int(nid[1:3]), int(nid[3:5]), int(nid[5:7])
    try:
        birth = datetime(year, month, day)
    except ValueError:
        return f"\n  {R('✖')} {R('تاريخ الميلاد داخل الرقم غير صحيح.')}\n"

    today = datetime.now()
    if birth > today:
        return f"\n  {R('✖')} {R('تاريخ الميلاد في المستقبل.')}\n"

    ay, am, ad = today.year - birth.year, today.month - birth.month, today.day - birth.day
    if ad < 0:
        am -= 1; ad += 30
    if am < 0:
        ay -= 1; am += 12

    gov = GOVERNORATES.get(nid[7:9], "غير معروف")
    gender = "ذكر" if int(nid[12]) % 2 else "أنثى"

    return f"""
  {M('◈')} {B('تحليل الرقم القومي')}
  {LINE}

  {D('الرقم')}      {W(nid)}
  {D('الميلاد')}    {C(birth.strftime('%Y-%m-%d'))}
  {D('العمر')}      {G(str(ay))} {D('سنة')}  {G(str(am))} {D('شهر')}  {G(str(ad))} {D('يوم')}
  {D('المحافظة')}   {Y(gov)}
  {D('النوع')}      {B(gender)}
  {D('التسلسل')}    {W(nid[9:13])}
  {D('التحقق')}     {W(nid[13])}

  {LINE}
"""


def main() -> None:
    print()
    print(f"  {M('◈')} {B('محلل الرقم القومي')}")
    print(f"  {D('────────────────')}")
    print()

    while True:
        try:
            raw = input(f"  {C('▸')} {D('الرقم (q للخروج):')} ").strip()
        except (EOFError, KeyboardInterrupt):
            print(f"\n  {D('تم الإغلاق.')}")
            break
        if raw.lower() == "q":
            print(f"  {D('تم الإغلاق.')}")
            break
        print(analyze(raw))


if __name__ == "__main__":
    main()