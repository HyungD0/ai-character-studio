// 사진 편집기: 정해진 칸(비율)에 맞게 드래그로 위치를, 슬라이더·휠·두 손가락으로 크기를 조절.
// PNG/WebP 의 투명 배경을 그대로 살려서 저장합니다.
(function () {
  const $ = (id) => document.getElementById(id);

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("이미지를 읽을 수 없어요"));
      img.src = src;
    });
  }

  // 투명 픽셀이 하나라도 있는지 (줄여서 검사)
  function hasTransparency(img) {
    const c = document.createElement("canvas");
    c.width = Math.min(200, img.width);
    c.height = Math.round(img.height * (c.width / img.width)) || 1;
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0, c.width, c.height);
    const data = g.getImageData(0, 0, c.width, c.height).data;
    for (let i = 3; i < data.length; i += 4) if (data[i] < 250) return true;
    return false;
  }

  // 투명이면 WebP(지원 안 하면 PNG), 아니면 JPEG
  function exportCanvas(canvas, transparent, quality) {
    if (!transparent) return canvas.toDataURL("image/jpeg", quality);
    const webp = canvas.toDataURL("image/webp", quality);
    return webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/png");
  }

  let state = null;

  function render() {
    const { img, frame, scale, x, y } = state;
    const g = frame.getContext("2d");
    g.clearRect(0, 0, frame.width, frame.height);
    g.drawImage(img, x, y, img.width * scale, img.height * scale);
  }

  function setScale(next, cx, cy) {
    const s = state;
    next = Math.min(s.maxScale, Math.max(s.minScale, next));
    // (cx, cy) 지점을 기준으로 확대·축소
    cx = cx ?? s.frame.width / 2;
    cy = cy ?? s.frame.height / 2;
    s.x = cx - (cx - s.x) * (next / s.scale);
    s.y = cy - (cy - s.y) * (next / s.scale);
    s.scale = next;
    $("ie-zoom").value = String(Math.log(next / s.coverScale));
    render();
  }

  // 화면 좌표 → 편집 캔버스 좌표
  function toCanvas(e) {
    const r = state.frame.getBoundingClientRect();
    return [(e.clientX - r.left) * (state.frame.width / r.width), (e.clientY - r.top) * (state.frame.height / r.height)];
  }

  function bindGestures(frame) {
    const pointers = new Map();
    let pinchStart = null;

    frame.onpointerdown = (e) => {
      frame.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, toCanvas(e));
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchStart = { dist: Math.hypot(a[0] - b[0], a[1] - b[1]), scale: state.scale };
      }
    };
    frame.onpointermove = (e) => {
      if (!pointers.has(e.pointerId)) return;
      const prev = pointers.get(e.pointerId);
      const cur = toCanvas(e);
      pointers.set(e.pointerId, cur);
      if (pointers.size === 1) {
        state.x += cur[0] - prev[0];
        state.y += cur[1] - prev[1];
        render();
      } else if (pointers.size === 2 && pinchStart) {
        const [a, b] = [...pointers.values()];
        const dist = Math.hypot(a[0] - b[0], a[1] - b[1]);
        setScale(pinchStart.scale * (dist / pinchStart.dist), (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      }
    };
    frame.onpointerup = frame.onpointercancel = (e) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinchStart = null;
    };
    frame.onwheel = (e) => {
      e.preventDefault();
      const [cx, cy] = toCanvas(e);
      setScale(state.scale * (e.deltaY < 0 ? 1.08 : 1 / 1.08), cx, cy);
    };
  }

  /**
   * 파일을 열어 편집기를 띄움.
   * @param file    이미지 파일
   * @param opts    { width, height, title } 결과 이미지 크기(비율)
   * @returns Promise<{ dataUrl, transparent } | null>  취소하면 null
   */
  async function open(file, opts) {
    const url = URL.createObjectURL(file);
    let img;
    try { img = await loadImage(url); } finally { URL.revokeObjectURL(url); }

    const frame = $("ie-canvas");
    frame.width = opts.width;
    frame.height = opts.height;
    const transparent = /png|webp|gif/.test(file.type) && hasTransparency(img);
    const coverScale = Math.max(opts.width / img.width, opts.height / img.height);
    const containScale = Math.min(opts.width / img.width, opts.height / img.height);
    state = {
      img, frame, transparent, coverScale,
      minScale: containScale * 0.4, maxScale: coverScale * 5,
      scale: coverScale, x: 0, y: 0,
    };
    // 처음엔 칸을 꽉 채우고 가운데 정렬 (투명 이미지는 전체가 보이게)
    state.scale = transparent ? containScale : coverScale;
    state.x = (opts.width - img.width * state.scale) / 2;
    state.y = (opts.height - img.height * state.scale) / 2;

    const zoom = $("ie-zoom");
    zoom.min = String(Math.log(state.minScale / coverScale));
    zoom.max = String(Math.log(state.maxScale / coverScale));
    zoom.step = "0.01";
    zoom.value = String(Math.log(state.scale / coverScale));
    zoom.oninput = () => setScale(coverScale * Math.exp(Number(zoom.value)));

    $("ie-title").textContent = opts.title || "사진 맞추기";
    $("ie-hint").textContent = transparent
      ? "✅ 투명 배경 이미지예요. 배경 위에 자연스럽게 올라가요."
      : "💡 배경이 투명한 PNG를 쓰면 방 배경 위에 캐릭터만 자연스럽게 보여요.";
    frame.classList.toggle("checker", transparent);
    frame.style.aspectRatio = `${opts.width} / ${opts.height}`;
    bindGestures(frame);
    render();
    $("image-editor").hidden = false;

    return new Promise((resolve) => {
      const done = (result) => {
        $("image-editor").hidden = true;
        $("ie-ok").onclick = $("ie-cancel").onclick = $("ie-fit").onclick = null;
        state = null;
        resolve(result);
      };
      $("ie-cancel").onclick = () => done(null);
      $("ie-fit").onclick = () => {
        const s = state;
        const fit = s.scale === coverScale ? containScale : coverScale; // 꽉 채우기 ↔ 전체 보기
        s.scale = fit;
        s.x = (opts.width - img.width * fit) / 2;
        s.y = (opts.height - img.height * fit) / 2;
        zoom.value = String(Math.log(fit / coverScale));
        render();
      };
      $("ie-ok").onclick = () => {
        // 칸 밖으로 빈 곳이 생겼으면 투명으로 저장 (사진이 칸보다 작게 줄어든 경우)
        const s = state;
        const leavesGap = s.x > 0.5 || s.y > 0.5 ||
          s.x + img.width * s.scale < opts.width - 0.5 || s.y + img.height * s.scale < opts.height - 0.5;
        const keepAlpha = transparent || leavesGap;
        done({ dataUrl: exportCanvas(frame, keepAlpha, 0.85), transparent: keepAlpha });
      };
    });
  }

  window.ImageEditor = { open, exportCanvas };
})();
