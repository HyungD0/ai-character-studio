// 공유용 "대화 카드" 이미지 만들기 (캔버스, 외부 라이브러리 없음)
// 1080×1350(인스타 4:5) 한 장에 캐릭터 사진 · 호감도 · 최근 대화 · "나도 만들기" 안내를 담습니다.
(function () {
  const W = 1080, H = 1350;
  const FONT = '"Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
  const t = window.I18N.t;

  // 호감도 단계 (0·20·40·60·80 이상)
  function levelTitle(affection) {
    return t(`level.${Math.max(0, Math.min(4, Math.floor(affection / 20)))}`);
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.roundRect(x, y, w, h, r);
  }

  // 글자를 maxWidth 에 맞춰 줄바꿈 (한글은 글자 단위로 끊음)
  function wrap(g, text, maxWidth, maxLines) {
    const lines = [];
    let line = "";
    for (const ch of text) {
      if (g.measureText(line + ch).width > maxWidth && line) {
        lines.push(line);
        line = ch;
        if (lines.length === maxLines) break;
      } else {
        line += ch;
      }
    }
    if (lines.length < maxLines && line) lines.push(line);
    if (lines.length === maxLines && lines.join("").length < text.length) {
      lines[maxLines - 1] = lines[maxLines - 1].slice(0, -1) + "…";
    }
    return lines;
  }

  // 사진을 상자에 꽉 차게(cover) 또는 전부 보이게(contain) 그리기
  function drawImageFit(g, img, x, y, w, h, contain) {
    const s = contain ? Math.min(w / img.width, h / img.height) : Math.max(w / img.width, h / img.height);
    const dw = img.width * s, dh = img.height * s;
    g.drawImage(img, x + (w - dw) / 2, contain ? y + h - dh : y + (h - dh) / 2, dw, dh);
  }

  /**
   * @param character  캐릭터 객체
   * @param photoSrc   지금 표정의 사진
   * @param messages   [{who: "me"|"her", text}] 최근 대화
   * @returns Promise<Blob> PNG
   */
  async function makeCard(character, photoSrc, messages) {
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const g = canvas.getContext("2d");

    // 배경
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#ffe1ec");
    bg.addColorStop(1, "#fff5f8");
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);

    // 캐릭터 사진 (왼쪽 위)
    const px = 60, py = 60, pw = 420, ph = 560;
    g.save();
    roundRect(g, px, py, pw, ph, 36);
    g.fillStyle = "#ffffff";
    g.fill();
    g.clip();
    try {
      drawImageFit(g, await loadImage(photoSrc), px, py, pw, ph, !!character.sprite);
    } catch { /* 사진을 못 불러와도 카드는 만듦 */ }
    g.restore();

    // 이름 · 호감도 (오른쪽 위)
    const tx = 530;
    g.fillStyle = "#3a2b33";
    g.font = `800 76px ${FONT}`;
    g.fillText(wrap(g, character.name, W - tx - 60, 1)[0], tx, 150);
    g.fillStyle = "#9a8790";
    g.font = `500 34px ${FONT}`;
    g.fillText(t("viral.affection"), tx, 205);

    const aff = Math.round(character.affection || 0);
    g.fillStyle = "#ff6fa5";
    g.font = `900 150px ${FONT}`;
    g.fillText(`${aff}%`, tx - 6, 370);

    // 호감도 막대
    roundRect(g, tx, 405, W - tx - 60, 30, 15);
    g.fillStyle = "#ffffff";
    g.fill();
    roundRect(g, tx, 405, Math.max(30, (W - tx - 60) * aff / 100), 30, 15);
    g.fillStyle = "#ff6fa5";
    g.fill();

    g.fillStyle = "#3a2b33";
    g.font = `700 44px ${FONT}`;
    g.fillText(`💗 ${levelTitle(aff)}`, tx, 510);

    // 최근 대화 말풍선
    let y = 680;
    const recent = messages.slice(-4);
    for (const m of recent) {
      g.font = `500 36px ${FONT}`;
      const lines = wrap(g, m.text, 640, 2);
      const bw = Math.max(...lines.map((l) => g.measureText(l).width)) + 56;
      const bh = lines.length * 48 + 34;
      const bx = m.who === "me" ? W - 60 - bw : 60;
      roundRect(g, bx, y, bw, bh, 30);
      g.fillStyle = m.who === "me" ? "#ff8db8" : "#ffffff";
      g.fill();
      g.fillStyle = m.who === "me" ? "#ffffff" : "#3a2b33";
      lines.forEach((l, i) => g.fillText(l, bx + 28, y + 56 + i * 48));
      y += bh + 20;
      if (y > H - 220) break;
    }

    // 아래 안내
    g.fillStyle = "#ff6fa5";
    roundRect(g, 60, H - 150, W - 120, 96, 48);
    g.fill();
    g.fillStyle = "#ffffff";
    g.font = `800 40px ${FONT}`;
    g.textAlign = "center";
    g.fillText(t("viral.footer"), W / 2, H - 88);
    g.textAlign = "start";

    return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  }

  // 인스타 스토리용 1080×1920: 카드를 가운데 두고, 아래는 링크 스티커를 붙일 자리로 비워 둠
  async function makeStory(cardBlob) {
    const SH = 1920;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = SH;
    const g = canvas.getContext("2d");
    const bg = g.createLinearGradient(0, 0, 0, SH);
    bg.addColorStop(0, "#ff8db8");
    bg.addColorStop(1, "#ffd3e4");
    g.fillStyle = bg;
    g.fillRect(0, 0, W, SH);

    g.fillStyle = "#ffffff";
    g.textAlign = "center";
    g.font = `800 56px ${FONT}`;
    g.fillText(t("viral.storyTop"), W / 2, 150);

    const url = URL.createObjectURL(cardBlob);
    try {
      const img = await loadImage(url);
      const cw = 920, ch = cw * H / W, cx = (W - cw) / 2, cy = 210;
      g.save();
      roundRect(g, cx, cy, cw, ch, 40);
      g.clip();
      g.drawImage(img, cx, cy, cw, ch);
      g.restore();
    } finally {
      URL.revokeObjectURL(url);
    }

    g.fillStyle = "rgba(255,255,255,0.9)";
    g.font = `700 40px ${FONT}`;
    g.fillText(t("viral.storyBottom"), W / 2, 1640);
    g.textAlign = "start";
    return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  }

  window.Viral = { makeCard, makeStory, levelTitle };
})();
