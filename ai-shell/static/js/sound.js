/* ExperMate 声音反馈：本地操作音效与古典背景音乐，不上传音频偏好。 */
(function () {
  "use strict";

  var KEY = "exdiary_sound_settings";
  var defaults = { sfx: true, sfxVolume: 65, bgm: false, bgmVolume: 12, bgmTrack: "" };
  var settings = load();
  var sfxAudios = {};
  var lastSfxAt = 0;
  var bgmAudio = null, bgmIndex = -1, bgmFading = null, bgmQueue = [];
  var bgmLoading = false, bgmNeedsAdvance = false;
  var bgmTracks = [
    { title: "帕赫贝尔《D大调卡农》", src: "/ai-shell/static/audio/classical/canon-in-d.ogg" },
    { title: "巴赫《C大调前奏曲》", src: "/ai-shell/static/audio/classical/bach-prelude-c-major.ogg" },
    { title: "巴赫《哥德堡变奏曲》咏叹调", src: "/ai-shell/static/audio/classical/bach-goldberg-aria.ogg" },
    { title: "巴赫《羊儿可以安静地吃草》", src: "/ai-shell/static/audio/classical/bach-sheep-may-safely-graze.ogg" },
    { title: "巴赫《G弦上的咏叹调》", src: "/ai-shell/static/audio/classical/bach-air-on-g-string.ogg" },
    { title: "巴赫《耶稣，世人仰望的喜悦》", src: "/ai-shell/static/audio/classical/bach-jesu-joy.ogg" },
    { title: "亨德尔《萨拉班德》HWV 437", src: "/ai-shell/static/audio/classical/handel-sarabande.ogg" },
    { title: "维瓦尔第《春》第二乐章 Largo", src: "/ai-shell/static/audio/classical/vivaldi-spring-largo.ogg" },
    { title: "维瓦尔第《夏》第二乐章 Adagio", src: "/ai-shell/static/audio/classical/vivaldi-summer-adagio.ogg" },
    { title: "维瓦尔第《秋》第二乐章 Adagio molto", src: "/ai-shell/static/audio/classical/vivaldi-autumn-adagio.ogg" },
    { title: "维瓦尔第《冬》第二乐章 Largo", src: "/ai-shell/static/audio/classical/vivaldi-winter-largo.ogg" },
    { title: "莫扎特《A大调钢琴协奏曲》K.488 第二乐章", src: "/ai-shell/static/audio/classical/mozart-k488-adagio.ogg" },
    { title: "莫扎特《A大调单簧管协奏曲》K.622 第二乐章", src: "/ai-shell/static/audio/classical/mozart-clarinet-concerto-adagio.ogg" },
    { title: "莫扎特《小夜曲》K.525（含第二乐章 Romanze）", src: "/ai-shell/static/audio/classical/mozart-k525-romanze.ogg" },
    { title: "贝多芬《致爱丽丝》", src: "/ai-shell/static/audio/classical/beethoven-fur-elise.ogg" },
    { title: "贝多芬《月光奏鸣曲》第一乐章", src: "/ai-shell/static/audio/classical/beethoven-moonlight-sonata.ogg" },
    { title: "贝多芬《悲怆奏鸣曲》第二乐章", src: "/ai-shell/static/audio/classical/beethoven-pathetique-adagio.ogg" },
    { title: "舒伯特《小夜曲》D.889", src: "/ai-shell/static/audio/classical/schubert-serenade.ogg" },
    { title: "舒伯特《即兴曲》Op.90 No.3", src: "/ai-shell/static/audio/classical/schubert-impromptu-op90-3.ogg" },
    { title: "肖邦《升C小调夜曲（遗作）》", src: "/ai-shell/static/audio/classical/chopin-nocturne-c-sharp-minor.ogg" },
    { title: "肖邦《降E大调夜曲》Op.9 No.2", src: "/ai-shell/static/audio/classical/chopin-nocturne-op9-2.ogg" },
    { title: "肖邦《E小调前奏曲》Op.28 No.4", src: "/ai-shell/static/audio/classical/chopin-prelude-op28-4.ogg" },
    { title: "肖邦《A小调圆舞曲（遗作）》", src: "/ai-shell/static/audio/classical/chopin-waltz-a-minor.ogg" },
    { title: "门德尔松《威尼斯船歌》Op.30 No.6", src: "/ai-shell/static/audio/classical/mendelssohn-venetian-gondola-song.ogg" },
    { title: "勃拉姆斯《摇篮曲》Op.49 No.4", src: "/ai-shell/static/audio/classical/brahms-lullaby.ogg" },
    { title: "德彪西《月光》", src: "/ai-shell/static/audio/classical/clair-de-lune.ogg" },
    { title: "德彪西《梦》", src: "/ai-shell/static/audio/classical/debussy-reverie.ogg" },
    { title: "萨蒂《裸体舞曲》第一首", src: "/ai-shell/static/audio/classical/gymnopedie-1.ogg" },
    { title: "萨蒂《玄秘曲》第一首", src: "/ai-shell/static/audio/classical/satie-gnossienne-1.ogg" },
    { title: "柴可夫斯基《六月·船歌》", src: "/ai-shell/static/audio/classical/tchaikovsky-june-barcarolle.ogg" }
  ];

  function load() {
    try { return Object.assign({}, defaults, JSON.parse(localStorage.getItem(KEY) || "{}")); }
    catch (e) { return Object.assign({}, defaults); }
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch (e) {} }
  function sfx(kind) {
    var sounds = {
      delete: { src: "/ai-shell/static/audio/uisfx/zen-57-delete.mp3", volume: .22 },
      message: { src: "/ai-shell/static/audio/uisfx/zen-04-message.mp3", volume: .20 },
      general: { src: "/ai-shell/static/audio/uisfx/zen-01-general.mp3", volume: .18 }
    };
    var name = sounds[kind] ? kind : "general", sound = sounds[name];
    var clip = sfxAudios[name];
    if (!clip) {
      clip = new Audio(sound.src);
      clip.preload = "auto";
      sfxAudios[name] = clip;
    }
    clip.pause(); clip.currentTime = 0;
    clip.volume = sound.volume * (settings.sfxVolume / 100);
    lastSfxAt = performance.now();
    clip.play().catch(function () {});
  }
  function play(kind) {
    if (!settings.sfx) return;
    sfx(kind);
  }
  function bgmLevel() { return Math.max(0, Math.min(30, Number(settings.bgmVolume) || 0)) / 100; }
  function currentTrack() { return bgmTracks[bgmIndex] || null; }
  function updateNowPlaying() {
    var el = document.getElementById("content-header-track");
    var track = currentTrack();
    if (!el) return;
    el.textContent = settings.bgm && bgmAudio && !bgmAudio.paused && track ? "♪ " + track.title : "";
    el.style.display = el.textContent ? "inline-block" : "none";
    var picker = document.getElementById("sound-bgm-track");
    if (picker && track && track.id) picker.value = track.id;
  }
  function savePlaybackState(playing) {
    var track = currentTrack();
    if (!track) return;
    fetch("/api/music/state", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playing: !!playing, track_id: track.id || "" }) }).catch(function () {});
  }
  function refreshLibrary() {
    return fetch("/api/music/library").then(function (response) { return response.json(); }).then(function (data) {
      if (!data.ok || !Array.isArray(data.tracks) || !data.tracks.length) return;
      bgmTracks = data.tracks;
      bgmQueue = [];
      if (selectedBgmIndex() < 0) { settings.bgmTrack = bgmTracks[0].id || "0"; save(); }
      bindSettings(document);
    }).catch(function () {});
  }
  function cancelBgmFade() {
    if (bgmFading) cancelAnimationFrame(bgmFading);
    bgmFading = null;
  }
  function fadeBgm(from, to, duration, done) {
    if (!bgmAudio) return;
    cancelBgmFade();
    var started = performance.now();
    function step(now) {
      var progress = Math.min(1, (now - started) / duration);
      bgmAudio.volume = from + (to - from) * progress;
      if (progress < 1) bgmFading = requestAnimationFrame(step);
      else { bgmFading = null; if (done) done(); }
    }
    bgmFading = requestAnimationFrame(step);
  }
  function selectedBgmIndex() {
    var selected = String(settings.bgmTrack || "");
    var index = bgmTracks.findIndex(function (track) { return String(track.id || "") === selected; });
    if (index >= 0) return index;
    return /^\d+$/.test(selected) && bgmTracks[Number(selected)] ? Number(selected) : -1;
  }
  function randomBgmIndex() {
    if (!bgmQueue.length) {
      bgmQueue = bgmTracks.map(function (track, index) { return index; });
      if (bgmQueue.length > 1) bgmQueue = bgmQueue.filter(function (index) { return index !== bgmIndex; });
      for (var i = bgmQueue.length - 1; i > 0; i -= 1) {
        var j = Math.floor(Math.random() * (i + 1)), swap = bgmQueue[i];
        bgmQueue[i] = bgmQueue[j]; bgmQueue[j] = swap;
      }
    }
    return bgmQueue.length ? bgmQueue.shift() : 0;
  }
  function advanceBgm() {
    if (!settings.bgm) return;
    bgmNeedsAdvance = false;
    nextBgm();
  }
  function nextBgm(trackId) {
    if (!settings.bgm || !bgmTracks.length) return;
    var selected = trackId === undefined ? -1 : bgmTracks.findIndex(function (track) {
      return String(track.id || "") === String(trackId || "");
    });
    bgmIndex = selected >= 0 ? selected : randomBgmIndex();
    if (selected >= 0) bgmQueue = bgmQueue.filter(function (index) { return index !== selected; });
    if (!bgmAudio) {
      bgmAudio = new Audio();
      bgmAudio.preload = "auto";
      bgmAudio.addEventListener("ended", advanceBgm);
      bgmAudio.addEventListener("error", function () {
        bgmLoading = false;
        bgmNeedsAdvance = true;
        if (!document.hidden) advanceBgm();
      });
    }
    var track = bgmTracks[bgmIndex];
    bgmLoading = true;
    bgmNeedsAdvance = false;
    bgmAudio.pause();
    bgmAudio.volume = 0;
    var started = false;
    function begin() {
      if (started || !settings.bgm || bgmTracks[bgmIndex] !== track) return;
      started = true;
      bgmAudio.play().then(function () {
        bgmLoading = false;
        settings.bgmTrack = track.id || ""; save();
        fadeBgm(0, bgmLevel(), 1800); savePlaybackState(true); updateNowPlaying();
      }).catch(function () {
        if (bgmTracks[bgmIndex] !== track) return;
        bgmLoading = false;
        bgmNeedsAdvance = true;
        updateNowPlaying();
      });
    }
    bgmAudio.addEventListener("canplay", begin, { once: true });
    bgmAudio.src = track.src;
    bgmAudio.load();
    if (bgmAudio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) begin();
  }
  function startBgm() {
    if (!settings.bgm) return;
    if (!bgmTracks.length) { refreshLibrary().then(startBgm); return; }
    if (!bgmAudio || bgmNeedsAdvance || bgmAudio.ended || (bgmAudio.paused && !bgmLoading)) advanceBgm();
    else fadeBgm(bgmAudio.volume, bgmLevel(), 300);
  }
  function stopBgm() {
    if (!bgmAudio || bgmAudio.paused) { savePlaybackState(false); updateNowPlaying(); return; }
    fadeBgm(bgmAudio.volume, 0, 700, function () {
      bgmAudio.pause(); bgmAudio.currentTime = 0; savePlaybackState(false); updateNowPlaying();
    });
  }
  function update(next) {
    settings = Object.assign({}, settings, next || {}); save();
    if (!settings.sfx) Object.keys(sfxAudios).forEach(function (key) {
      sfxAudios[key].pause(); sfxAudios[key].currentTime = 0;
    });
    if (!settings.bgm) stopBgm();
    else if (next && Object.prototype.hasOwnProperty.call(next, "bgmTrack")) nextBgm(next.bgmTrack);
    else if (next && Object.prototype.hasOwnProperty.call(next, "bgmVolume") && bgmAudio) {
      cancelBgmFade();
      bgmAudio.volume = bgmLevel();
      if (bgmAudio.paused) startBgm();
    } else if (bgmAudio && !bgmAudio.paused) fadeBgm(bgmAudio.volume, bgmLevel(), 180);
  }
  function bindSettings(root) {
    root = root || document;
    var sfx = root.querySelector("#sound-sfx"), sfxVolume = root.querySelector("#sound-sfx-volume");
    var bgm = root.querySelector("#sound-bgm"), bgmVolume = root.querySelector("#sound-bgm-volume");
    var bgmTrack = root.querySelector("#sound-bgm-track");
    if (sfx) sfx.checked = settings.sfx;
    if (sfxVolume) sfxVolume.value = settings.sfxVolume;
    if (bgm) bgm.checked = settings.bgm;
    if (bgmVolume) bgmVolume.value = settings.bgmVolume;
    if (bgmTrack) {
      bgmTrack.innerHTML = bgmTracks.map(function (track, index) {
        return '<option value="' + (track.id || index) + '">' + track.title + '</option>';
      }).join("");
      bgmTrack.value = String(settings.bgmTrack || (bgmTracks[0] && (bgmTracks[0].id || "0")) || "");
    }
  }

  document.addEventListener("change", function (event) {
    var control = event.target;
    if (control.id === "sound-sfx") { update({ sfx: control.checked }); if (control.checked) play("general"); }
    if (control.id === "sound-bgm") { update({ bgm: control.checked }); if (control.checked) startBgm(); }
    if (control.id === "sound-bgm-track") update({ bgmTrack: control.value });
  });
  document.addEventListener("input", function (event) {
    var control = event.target;
    if (control.id === "sound-sfx-volume") update({ sfxVolume: Number(control.value) });
    if (control.id === "sound-bgm-volume") update({ bgmVolume: Number(control.value) });
  });

  function isDeletionControl(control) {
    var label = /^(BUTTON|A|SUMMARY)$/.test(control.tagName) ? (control.textContent || "") : "";
    var marker = ((control.id || "") + " " + (control.className || "") + " " +
      (control.getAttribute("data-action") || "") + " " + label).toLowerCase();
    return /delete|remove|archive|danger|删除|移除|归档/.test(marker);
  }
  document.addEventListener("click", function (event) {
    var target = event.target;
    if (!target || !target.closest) return;
    var control = target.closest('button, a[href], summary, [role="button"], [onclick], [tabindex="0"], input[type="button"], input[type="submit"], input[type="file"], input[type="checkbox"], input[type="radio"], select');
    if (!control || control.disabled || control.closest("[data-sfx-silent]") || isDeletionControl(control)) return;
    window.setTimeout(function () {
      if (performance.now() - lastSfxAt < 80) return;
      play("general");
    }, 0);
  });

  function resumeBgmAfterVisibilityChange() {
    if (document.hidden || !settings.bgm) return;
    if (!bgmTracks.length) { refreshLibrary().then(resumeBgmAfterVisibilityChange); return; }
    if (!bgmAudio || bgmNeedsAdvance || bgmAudio.ended || (bgmAudio.paused && !bgmLoading)) advanceBgm();
  }
  document.addEventListener("visibilitychange", resumeBgmAfterVisibilityChange);
  window.addEventListener("focus", resumeBgmAfterVisibilityChange);
  document.addEventListener("pointerdown", function () { if (settings.bgm) startBgm(); }, { passive: true });
  document.addEventListener("keydown", function () { if (settings.bgm) startBgm(); });

  function applyMusicControl(result) {
    if (!result || result.display !== "music_control") return;
    if (result.action === "add") { refreshLibrary(); return; }
    if (result.action === "stop") { update({ bgm: false }); updateNowPlaying(); return; }
    if ((result.action === "play" || result.action === "next") && result.track) {
      settings.bgm = true;
      settings.bgmTrack = result.track.id || "";
      save();
      refreshLibrary().then(function () { nextBgm(result.track.id || ""); });
    }
  }
  refreshLibrary();

  window.ExdiarySound = { play: play, bindSettings: bindSettings, nextBgm: nextBgm,
    applyMusicControl: applyMusicControl, refreshLibrary: refreshLibrary,
    getSettings: function () { return Object.assign({}, settings); } };
})();
