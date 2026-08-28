"""背景音乐曲库：内置曲目与当前账号上传音频的统一视图。"""

from __future__ import annotations

from typing import Any


_BUILTIN = [
    ("canon-in-d", "帕赫贝尔《D大调卡农》", "canon-in-d.ogg"),
    ("bach-prelude-c-major", "巴赫《C大调前奏曲》", "bach-prelude-c-major.ogg"),
    ("bach-goldberg-aria", "巴赫《哥德堡变奏曲》咏叹调", "bach-goldberg-aria.ogg"),
    ("bach-sheep-may-safely-graze", "巴赫《羊儿可以安静地吃草》", "bach-sheep-may-safely-graze.ogg"),
    ("bach-air-on-g-string", "巴赫《G弦上的咏叹调》", "bach-air-on-g-string.ogg"),
    ("bach-jesu-joy", "巴赫《耶稣，世人仰望的喜悦》", "bach-jesu-joy.ogg"),
    ("handel-sarabande", "亨德尔《萨拉班德》HWV 437", "handel-sarabande.ogg"),
    ("vivaldi-spring-largo", "维瓦尔第《春》第二乐章 Largo", "vivaldi-spring-largo.ogg"),
    ("vivaldi-summer-adagio", "维瓦尔第《夏》第二乐章 Adagio", "vivaldi-summer-adagio.ogg"),
    ("vivaldi-autumn-adagio", "维瓦尔第《秋》第二乐章 Adagio molto", "vivaldi-autumn-adagio.ogg"),
    ("vivaldi-winter-largo", "维瓦尔第《冬》第二乐章 Largo", "vivaldi-winter-largo.ogg"),
    ("mozart-k488-adagio", "莫扎特《A大调钢琴协奏曲》K.488 第二乐章", "mozart-k488-adagio.ogg"),
    ("mozart-clarinet-concerto-adagio", "莫扎特《A大调单簧管协奏曲》K.622 第二乐章", "mozart-clarinet-concerto-adagio.ogg"),
    ("mozart-k525-romanze", "莫扎特《小夜曲》K.525（含第二乐章 Romanze）", "mozart-k525-romanze.ogg"),
    ("beethoven-fur-elise", "贝多芬《致爱丽丝》", "beethoven-fur-elise.ogg"),
    ("beethoven-moonlight-sonata", "贝多芬《月光奏鸣曲》第一乐章", "beethoven-moonlight-sonata.ogg"),
    ("beethoven-pathetique-adagio", "贝多芬《悲怆奏鸣曲》第二乐章", "beethoven-pathetique-adagio.ogg"),
    ("schubert-serenade", "舒伯特《小夜曲》D.889", "schubert-serenade.ogg"),
    ("schubert-impromptu-op90-3", "舒伯特《即兴曲》Op.90 No.3", "schubert-impromptu-op90-3.ogg"),
    ("chopin-nocturne-c-sharp-minor", "肖邦《升C小调夜曲（遗作）》", "chopin-nocturne-c-sharp-minor.ogg"),
    ("chopin-nocturne-op9-2", "肖邦《降E大调夜曲》Op.9 No.2", "chopin-nocturne-op9-2.ogg"),
    ("chopin-prelude-op28-4", "肖邦《E小调前奏曲》Op.28 No.4", "chopin-prelude-op28-4.ogg"),
    ("chopin-waltz-a-minor", "肖邦《A小调圆舞曲（遗作）》", "chopin-waltz-a-minor.ogg"),
    ("mendelssohn-venetian-gondola-song", "门德尔松《威尼斯船歌》Op.30 No.6", "mendelssohn-venetian-gondola-song.ogg"),
    ("brahms-lullaby", "勃拉姆斯《摇篮曲》Op.49 No.4", "brahms-lullaby.ogg"),
    ("clair-de-lune", "德彪西《月光》", "clair-de-lune.ogg"),
    ("debussy-reverie", "德彪西《梦》", "debussy-reverie.ogg"),
    ("gymnopedie-1", "萨蒂《裸体舞曲》第一首", "gymnopedie-1.ogg"),
    ("satie-gnossienne-1", "萨蒂《玄秘曲》第一首", "satie-gnossienne-1.ogg"),
    ("tchaikovsky-june-barcarolle", "柴可夫斯基《六月·船歌》", "tchaikovsky-june-barcarolle.ogg"),
]

_AUDIO_SUFFIXES = {".mp3", ".ogg", ".wav", ".m4a", ".aac", ".flac"}


def is_audio_attachment(name: str, mime: str) -> bool:
    suffix = "." + name.rsplit(".", 1)[-1].lower() if "." in name else ""
    return suffix in _AUDIO_SUFFIXES or str(mime or "").lower().startswith("audio/")


def builtin_tracks() -> list[dict[str, str]]:
    return [
        {"id": f"builtin:{slug}", "title": title,
         "src": f"/ai-shell/static/audio/classical/{filename}", "source": "builtin"}
        for slug, title, filename in _BUILTIN
    ]


def library_for(store: Any) -> list[dict[str, str]]:
    tracks = builtin_tracks()
    for item in store.list_music_tracks():
        tracks.append({
            "id": f"attachment:{item['sha256']}",
            "title": item.get("title") or item.get("name") or "未命名音频",
            "src": f"/api/attachments/{item['sha256']}",
            "source": "attachment",
        })
    return tracks
