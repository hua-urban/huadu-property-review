"use strict";
(() => {
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const esc = (v) =>
    String(v ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  const categories = ["整合", "出售", "出租", "貸款活化"];
  const statusNames = {
    draft: "尚未送審",
    pending: "待評估",
    needs_info: "待補充",
    published: "已評估",
    withdrawn: "已撤回",
    expired: "已失效",
    deleted: "已封存",
  };
  const icons = { 整合: "▦", 出售: "⌂", 出租: "▤", 貸款活化: "↗" };
  const reviewAdapter = window.HUADU_REVIEW_ADAPTER;
  const publicAdapter = window.HUADU_PUBLIC_ADAPTER;
  const adminEntry =
    !publicAdapter && (document.body.dataset.adminEntry === "true" ||
    new URLSearchParams(location.search).get("admin") === "1");
  const sessionKey = reviewAdapter
    ? "huaduIntakeReviewV2"
    : adminEntry
      ? "huaduLeadershipSessionV2"
      : publicAdapter ? "huaduIntakeHttpV3" : "huaduIntakeSessionV2";
  const gas =
    typeof google !== "undefined" && google.script && google.script.run;
  const state = {
    token: sessionStorage.getItem(sessionKey) || "",
    user: null,
    members: [],
    cases: [],
    view: "overview",
    loginMode: "member",
    environment: reviewAdapter ? "review" : publicAdapter ? "google-public" : gas ? "google" : "local",
    query: "",
    category: "",
    status: "",
    files: [],
    imageUrls: [],
    submission: null,
    busy: false,
    detail: null,
  };
  let toastTimer, lastFocus;
  const roleName = (role) =>
    ({ member: "會內夥伴", reviewer: "九長管理", info: "資訊組管理" })[role] ||
    "會內夥伴";
  const staff = () => state.user && state.user.role !== "member";
  const info = () => state.user && state.user.role === "info";
  const date = (value) =>
    value
      ? new Date(value).toLocaleDateString("zh-TW", {
          month: "2-digit",
          day: "2-digit",
        })
      : "—";
  const badge = (s) =>
    `<span class="tag ${s === "published" ? "green" : s === "pending" ? "gold" : s === "needs_info" ? "wine" : "gray"}">${esc(statusNames[s] || s)}</span>`;
  function toast(message, error = false) {
    const n = $("#toast");
    n.textContent = message;
    n.className = "toast show" + (error ? " error" : "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => n.classList.remove("show"), 5000);
  }
  async function api(action, payload = {}) {
    const request = { action, payload, token: state.token };
    let result;
    if (reviewAdapter) result = await reviewAdapter.rpc(request);
    else if (publicAdapter) result = await publicAdapter.rpc(request);
    else if (gas)
      result = await new Promise((resolve, reject) =>
        google.script.run
          .withSuccessHandler(resolve)
          .withFailureHandler((e) =>
            reject(new Error(e.message || "服務暫時無法使用")),
          )
          .rpc(request),
      );
    else {
      const response = await fetch("/api", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        credentials: "same-origin",
      });
      result = await response.json();
    }
    if (!result?.ok) {
      if (
        ["UNAUTHORIZED", "SESSION_EXPIRED", "AUTH_REQUIRED"].includes(
          result?.error?.code,
        ) &&
        action !== "login"
      ) {
        state.token = "";
        state.user = null;
        sessionStorage.removeItem(sessionKey);
        if (adminEntry) renderLogin();
      }
      const failure = new Error(result?.error?.message || "操作未完成，請稍後再試。");
      failure.code = result?.error?.code;
      throw failure;
    }
    return result.data;
  }
  const brandIcon = reviewAdapter || publicAdapter ? "brand/icon-512.png" : "https://hua-urban.com/property-platform/brand/icon-512.png";
  function brandMark() { return `<img class="brand-mark brand-icon" src="${brandIcon}" alt="都更">`; }
  function brand() {
    return `<div class="brand">${brandMark()}<div><strong>華都更</strong><small>PROPERTY COLLABORATION</small></div></div>`;
  }
  function renderLogin(error = "") {
    document.title = "領導團隊登入｜華都更";
    const local = state.environment === "local" && !reviewAdapter;
    $("#app").innerHTML =
      `<main id="main" class="leadership-login"><a href="https://hua-urban.com/admin/" class="hint">← 返回華都更管理中心</a><div class="panel leadership-login-card">${brand()}<h1>需求媒合後臺</h1><p>董顧、九長及授權領導團隊專用。</p>${error ? `<div class="notice error" role="alert">${esc(error)}</div>` : ""}${local ? `<form id="login-form"><input type="hidden" name="mode" value="admin">${field("username", "本機測試帳號", { required: true })}${field("password", "本機測試密碼", { type: "password", required: true })}<button class="btn primary" type="submit">登入本機測試後臺</button><p class="hint">僅本機：reviewer／huadu-review-demo，或 info／huadu-info-demo。</p></form>` : `<button class="btn primary" data-action="google-login">使用 Google 帳戶登入</button><p class="hint">僅限已授權帳戶。請在 Google 畫面選擇您的帳戶。</p>`}</div></main>`;
  }
  function navigation() {
    return `<div class="nav-title">領導團隊</div>${[
      ["review", "☷", "需求與媒合"],
      ["new", "＋", "代為登錄需求"],
    ]
      .map(
        ([v, i, label]) =>
          `<button class="nav-link ${state.view === v ? "active" : ""}" data-view="${v}"><span class="nav-icon">${i}</span>${label}</button>`,
      )
      .join("")}`;
  }
  function shell(content) {
    const notice = reviewAdapter
      ? '<div class="notice review-notice">登錄頁示範：資料只保存在此瀏覽器，不會寄出確認信。請勿填入真實個資。</div>'
      : "";
    if (!staff()) {
      $("#app").innerHTML =
        `<div class="intake-shell"><header class="intake-header">${brand()}<a class="btn small subtle" href="https://hua-urban.com/">回華都更首頁</a></header><main id="main" class="intake-content" tabindex="-1">${notice}${content}</main><footer class="intake-footer">華都更・房地產需求登錄　｜　登錄內容僅供授權領導團隊協助媒合與引薦。</footer></div>`;
      document.title =
        state.view === "receipt"
          ? "需求登錄資料｜華都更"
          : "房地產需求登錄｜華都更";
      return;
    }
    $("#app").innerHTML =
      `<div class="shell"><aside class="sidebar" aria-label="主要導覽">${brand()}<nav>${navigation()}</nav><div class="sidebar-bottom"><a class="nav-link" href="https://hua-urban.com/admin/">← 管理中心</a><button class="nav-link" data-action="logout">登出</button></div></aside><div class="main-wrap"><header class="topbar"><button class="mobile-menu" aria-label="開啟或關閉選單" aria-expanded="false" data-action="menu">☰</button><div class="breadcrumb">華都更 <span>／　需求媒合後臺</span></div><div class="account"><span class="tag">領導團隊專用</span><span>${esc(state.user?.displayName || "已授權 Google 帳戶")}</span></div></header><main id="main" class="content" tabindex="-1">${content}<footer class="page-footer"><span>華都更・需求媒合後臺</span><span>v0.2.0</span></footer></main></div></div>`;
    document.title = "需求媒合後臺｜華都更";
  }
  const pageHead = (eye, title, desc, actions = "") =>
    `<div class="page-head"><div><div class="eyebrow">${eye}</div><h1>${title}</h1><p>${desc}</p></div>${actions}</div>`;
  function filteredCases() {
    return state.cases.filter(
      (c) =>
        (!state.query ||
          [c.title, c.city, c.district, c.summary, c.description]
            .join(" ")
            .toLowerCase()
            .includes(state.query.toLowerCase())) &&
        (!state.category || c.categories?.includes(state.category)) &&
        (!state.status || c.status === state.status),
    );
  }
  function filterbar(admin = false) {
    return `<div class="filterbar"><div class="searchbox"><span aria-hidden="true">⌕</span><label class="sr-only" for="case-search">搜尋案件、地區或需求</label><input id="case-search" type="search" value="${esc(state.query)}" placeholder="搜尋案件、地區或需求…"></div><label class="sr-only" for="category-filter">需求分類</label><select id="category-filter"><option value="">所有需求</option>${categories.map((c) => `<option ${c === state.category ? "selected" : ""}>${c}</option>`).join("")}</select>${
      admin
        ? `<label class="sr-only" for="status-filter">案件狀態</label><select id="status-filter"><option value="">所有狀態</option>${Object.entries(
            statusNames,
          )
            .map(
              ([k, v]) =>
                `<option value="${k}" ${k === state.status ? "selected" : ""}>${v}</option>`,
            )
            .join("")}</select>`
        : ""
    }</div>`;
  }
  function empty(
    title = "目前還沒有已評估案件",
    text = "夥伴提出需求後，由九長審核發布。第一筆協作，也許就從您開始。",
  ) {
    return `<div class="empty"><div class="empty-symbol">⌂</div><h3>${title}</h3><p>${text}</p><button class="btn primary" data-view="new">＋ 提出一筆需求</button></div>`;
  }
  function cards(cases) {
    return cases.length
      ? `<div class="case-grid">${cases.map((c) => `<button class="case-card" data-case="${esc(c.id)}" aria-label="查看${esc(c.title)}"><div class="case-cover">${c.images?.length ? `<img data-image="${esc(c.images[0].id)}" alt="${esc(c.title)}的物件圖片" loading="lazy">` : `<span class="cover-type">${esc(c.propertyType || "房地")}</span>`}<div class="badge">${badge(c.status)}</div></div><div class="case-body"><div class="row wrap">${(c.categories || []).map((v) => `<span class="tag wine">${esc(v)}</span>`).join("")}</div><h3>${esc(c.title)}</h3><div class="case-location">⌖ ${esc([c.city, c.district].filter(Boolean).join("・") || "地區待補充")}</div><div class="case-excerpt">${esc(c.summary || c.helpNeeded || c.description)}</div><div class="case-footer"><span>${esc(c.memberName || "會內夥伴")} 提報</span><span>${date(c.publishedAt || c.updatedAt || c.createdAt)} 更新 ↗</span></div></div></button>`).join("")}</div>`
      : empty(
          state.query || state.category
            ? "沒有符合條件的案件"
            : "目前還沒有已評估案件",
          state.query || state.category
            ? "試試其他地區、關鍵字，或切換需求分類。"
            : undefined,
        );
  }
  function stats() {
    const published = state.cases.filter((c) => c.status === "published");
    return `<div class="stats">${categories.map((c) => `<div class="stat"><div class="stat-label">${c}<span class="stat-icon">${icons[c]}</span></div><div class="stat-number">${published.filter((x) => x.categories?.includes(c)).length}<small style="font-size:12px;font-weight:400;margin-left:6px;color:var(--muted)">件</small></div><div class="stat-foot">已評估的協作需求</div></div>`).join("")}</div>`;
  }
  function renderOverview() {
    shell(
      `${pageHead("PROPERTY COLLABORATION", "讓資源，連成機會。", "從一個標的、一份需求，開始下一次會內協作。", '<button class="btn primary" data-view="new">＋ 提出需求</button>')}<section class="hero"><div class="hero-copy"><div class="eyebrow">夥伴的需要，會內一起想辦法</div><h2>手上的房地產需求，<br>不必一個人找答案。</h2><p>整合、出售、出租或貸款活化，先說說您的需求。<br>讓九長協助盤點，讓合適的專業接上線。</p><button class="btn" data-view="new">填寫需求 <span>→</span></button></div><div class="hero-art" aria-hidden="true"><span></span>${[1, 2, 3].map(() => '<div class="building">' + Array(12).fill("<i></i>").join("") + "</div>").join("")}</div></section>${stats()}<section><div class="section-head"><div><h2>最新協作案件</h2><p>經九長審核後，開放會內查看與下載</p></div><button class="btn small subtle" data-view="cases">查看全部 →</button></div>${cards(state.cases.filter((c) => c.status === "published").slice(0, 6))}</section><div class="steps-strip">${[
        ["01", "提出需求", "一個標的一筆資料，說明希望獲得的協助。"],
        ["02", "九長盤點", "確認資料與分享內容，評估可串聯的資源。"],
        ["03", "會內協作", "查看核准案件，透過聯絡窗口展開下一步。"],
      ]
        .map(
          ([n, t, d]) =>
            `<div class="step-item"><span>${n}</span><div><strong>${t}</strong><p>${d}</p></div></div>`,
        )
        .join("")}</div>`,
    );
    hydrateImages();
  }
  function renderCases() {
    shell(
      `${pageHead("MEMBER EXCHANGE", "會內案件", "找到您能協助的需求，讓專業成為夥伴的資源。", '<button class="btn" data-action="export">↓ 下載清單</button>')}${filterbar()}<div id="results">${caseResults()}</div>`,
    );
    hydrateImages();
  }
  function caseResults() {
    const list = filteredCases().filter((c) => c.status === "published");
    return `<p class="result-count">共 ${list.length} 件已評估案件${state.category ? " · " + esc(state.category) : ""}</p>${cards(list)}`;
  }
  function renderReview() {
    const list = filteredCases();
    shell(
      `${pageHead("REVIEW WORKSPACE", "需求與媒合", "僅供授權領導團隊協助媒合與引薦。", '<button class="btn" data-action="export">↓ 下載清單</button>')}<div class="panel">${filterbar(true)}<div id="review-results">${reviewResults(list)}</div></div>`,
    );
  }
  function reviewResults(list = filteredCases()) {
    return `<div class="result-count">共 ${list.length} 件 · 待審核 ${state.cases.filter((c) => c.status === "pending").length} 件</div>${list.length ? `<div class="table-wrap"><table><thead><tr><th>案件／地區</th><th>需求</th><th>提報人</th><th>狀態</th><th>更新</th><th>操作</th></tr></thead><tbody>${list.map((c) => `<tr><td><strong>${esc(c.title)}</strong><span class="muted">${esc([c.city, c.district].filter(Boolean).join(" "))}</span></td><td>${(c.categories || []).map((x) => `<span class="tag wine">${esc(x)}</span>`).join(" ")}</td><td>${esc(c.memberName || c.memberId)}</td><td>${badge(c.status)}</td><td>${date(c.updatedAt || c.createdAt)}</td><td><button class="btn small" data-case="${esc(c.id)}">查看${c.status === "pending" ? "與審核" : ""}</button></td></tr>`).join("")}</tbody></table></div>` : empty("目前沒有案件", "新的提報送出後，會顯示在這裡。")}`;
  }
  function field(name, label, opts = {}) {
    const {
      required = false,
      type = "text",
      placeholder = "",
      value = "",
      hint = "",
      textarea = false,
      options = null,
      span = false,
    } = opts;
    return `<div class="field ${span ? "span-2" : ""}"><label for="${name}">${label}${required ? '<span class="required">＊</span>' : ""}</label>${options ? `<select id="${name}" name="${name}" ${required ? "required" : ""}><option value="">請選擇</option>${options.map((o) => (typeof o === "string" ? `<option ${o === value ? "selected" : ""}>${esc(o)}</option>` : `<option value="${esc(o.value)}" ${o.value === value ? "selected" : ""}>${esc(o.label)}</option>`)).join("")}</select>` : textarea ? `<textarea id="${name}" name="${name}" ${required ? "required" : ""} maxlength="6000" placeholder="${esc(placeholder)}">${esc(value)}</textarea>` : `<input id="${name}" name="${name}" type="${type}" ${required ? "required" : ""} value="${esc(value)}" maxlength="${name === "title" ? 100 : 500}" placeholder="${esc(placeholder)}">`}${hint ? `<p class="hint">${hint}</p>` : ""}</div>`;
  }
  function renderForm(edit = null) {
    state.editing = edit;
    const v = (key) => edit?.[key] || "";
    shell(
      `${pageHead("", edit ? "修改需求" : "房地產需求登錄", edit ? "修改後重新交由領導團隊評估。" : "填寫物件與需求，由董顧、九長及授權領導團隊協助媒合、引薦。")}<form id="case-form"><div class="form-layout"><div><section class="form-section"><h2><span>01</span>物件與需求</h2><p class="section-desc">一個標的一筆資料，需求可複選。</p><div class="form-grid">${field("title", "物件名稱", { required: true, value: v("title"), placeholder: "例如：大安區老屋整合需求", span: true })}${field("propertyType", "標的類型", { required: true, value: v("propertyType"), options: ["房屋", "土地", "其他"] })}${field("city", "縣市", { required: true, value: v("city"), options: ["臺北市", "新北市", "桃園市", "新竹市", "新竹縣", "苗栗縣", "臺中市", "彰化縣", "南投縣", "雲林縣", "嘉義市", "嘉義縣", "臺南市", "高雄市", "屏東縣", "基隆市", "宜蘭縣", "花蓮縣", "臺東縣", "澎湖縣", "金門縣", "連江縣"] })}${field("district", "行政區", { required: true, value: v("district"), placeholder: "例如：大安區" })}${field("location", "詳細位置（選填）", { value: v("location"), placeholder: "路段、門牌或地號" })}<div class="field span-2"><label>需求類別<span class="required">＊</span><span class="hint">　可複選</span></label><div class="choice-grid">${categories.map((c) => `<label class="choice"><span class="choice-icon" aria-hidden="true">${icons[c]}</span>${c}<input type="checkbox" name="categories" value="${c}" ${edit?.categories?.includes(c) ? "checked" : ""}></label>`).join("")}</div></div>${field("description", "標的現況與需求說明", { required: true, value: v("description"), textarea: true, span: true, placeholder: "請說明目前情況、已知條件與需要處理的事情。" })}${field("helpNeeded", "希望會內協助什麼？", { required: true, value: v("helpNeeded"), textarea: true, span: true, placeholder: "例如：尋找整合夥伴、介紹租售窗口、討論貸款活化方向。" })}</div></section>${edit ? "" : `<section class="form-section"><h2><span>02</span>相關圖片 <small class="muted" style="font-size:12px;font-weight:400">選填</small></h2><p class="section-desc">JPG、PNG，每張最多25MB，每案最多15張。</p><label class="upload-zone" for="images"><strong>選擇圖片或拖曳檔案</strong><input id="images" type="file" accept="image/jpeg,image/png" multiple></label><div id="image-previews" class="image-previews"></div></section>`}<section class="form-section"><h2><span>${edit ? "02" : "03"}</span>聯絡資料</h2><p class="section-desc">確認信與本次物件的專屬連結將寄至此 Email。</p><div class="form-grid">${field("submitterName", "填報人姓名", { required: true, value: v("submitterName") || v("memberName"), placeholder: "您的姓名" })}${field("submitterEmail", "Email", { required: true, type: "email", value: v("submitterEmail") || v("contact"), placeholder: "name@example.com" })}${field("submitterPhone", "手機（選填）", { type: "tel", value: v("submitterPhone"), placeholder: "例如：0912-345-678" })}<div class="field span-2"><label class="checkbox-line"><input type="checkbox" name="onBehalf" id="onBehalf" ${edit?.onBehalf ? "checked" : ""}>我代其他人登錄這筆需求</label></div>${field("relationship", "與標的的關係（代登錄時必填）", { value: v("relationship"), placeholder: "例如：本人持有、受託處理、親友轉介", span: true })}</div><label class="checkbox-line"><input type="checkbox" id="shareConsent" name="shareConsent" required ${edit ? "checked" : ""}>我確認有權提供上述資料，同意由授權領導團隊用於媒合、引薦及後續聯繫，並寄送本次登錄確認信。物件不開放一般會員瀏覽。</label>${edit ? field("reason", "修改原因", { required: true, textarea: true }) : ""}<div id="form-error" class="notice error" role="alert" hidden></div><div id="form-progress" class="form-progress" role="status"></div></section><div class="form-actions"><span class="hint">請確認 Email 正確，以接收物件連結。</span><button class="btn primary" id="submit-case" type="submit">${edit ? "儲存修改" : "確認資料並送出"} →</button></div></div><aside class="form-aside"><div class="panel"><h3>登錄後會怎麼處理？</h3><p class="hint">領導團隊會盤點需求，尋找合適資源協助媒合與引薦。如需補充資料，會依您留下的 Email 或手機聯繫。</p><div class="divider"></div><h3>查看自己的物件</h3><p class="hint">送出後，請由確認信中的專屬連結查看本次登錄內容。連結請妥善保管。</p></div></aside></div></form>`,
    );
    renderPreviews();
    const zone = $(".upload-zone");
    if (zone) {
      zone.addEventListener("dragover", (e) => e.preventDefault());
      zone.addEventListener("drop", (e) => {
        e.preventDefault();
        addFiles([...e.dataTransfer.files]);
      });
    }
  }
  function addFiles(files) {
    if (state.submission) {
      toast("這筆資料已開始上傳，請先完成送審。", true);
      return;
    }
    for (const f of files) {
      if (state.files.length >= 15) {
        toast("每案最多 15 張圖片。", true);
        break;
      }
      if (!["image/jpeg", "image/png"].includes(f.type)) {
        toast(`${f.name}：請選擇 JPG 或 PNG。`, true);
        continue;
      }
      if (f.size > 25 * 1024 * 1024) {
        toast(`${f.name}：超過 25MB 上限。`, true);
        continue;
      }
      state.files.push(f);
    }
    renderPreviews();
  }
  function renderPreviews() {
    const target = $("#image-previews");
    if (!target) return;
    state.imageUrls.forEach(URL.revokeObjectURL);
    state.imageUrls = [];
    target.innerHTML = state.files
      .map((f, i) => {
        const u = URL.createObjectURL(f);
        state.imageUrls.push(u);
        return `<div class="image-preview"><img src="${u}" alt="待上傳圖片 ${i + 1}"><small>${esc(f.name)}</small><button type="button" data-remove-image="${i}" ${state.submission ? "disabled" : ""}>移除</button></div>`;
      })
      .join("");
  }
  function formPayload(form) {
    const fd = new FormData(form);
    return {
      title: fd.get("title").trim(),
      memberId: state.editing?.memberId || "",
      submitterName: fd.get("submitterName").trim(),
      submitterEmail: fd.get("submitterEmail").trim(),
      submitterPhone: fd.get("submitterPhone").trim(),
      contact: fd.get("submitterEmail").trim(),
      propertyType: fd.get("propertyType"),
      city: fd.get("city"),
      district: fd.get("district").trim(),
      location: fd.get("location").trim(),
      categories: fd.getAll("categories"),
      description: fd.get("description").trim(),
      helpNeeded: fd.get("helpNeeded").trim(),
      summary: state.editing?.summary || "",
      onBehalf: fd.has("onBehalf"),
      relationship: fd.get("relationship").trim(),
      shareConsent: fd.has("shareConsent"),
    };
  }
  async function submitCase(form) {
    if (state.busy) return;
    const payload = formPayload(form);
    if (!payload.categories.length) {
      toast("請至少選擇一種需求。", true);
      return;
    }
    if (payload.onBehalf && !payload.relationship) {
      $("#relationship").focus();
      toast("代他人提報時，請說明與標的的關係。", true);
      return;
    }
    if (!state.submission && !state.editing) {
      openConfirm(payload);
      return;
    }
    await persistCase(payload, form);
  }
  function openConfirm(p) {
    openModal(
      "送出前，確認一下",
      `<div class="eyebrow">登錄資料確認</div><h2 class="detail-title">${esc(p.title)}</h2><div class="row wrap">${p.categories.map((c) => `<span class="tag wine">${esc(c)}</span>`).join("")}</div><dl class="detail-meta"><div><dt>標的地區</dt><dd>${esc(p.city + " " + p.district)}</dd></div><div><dt>圖片</dt><dd>${state.files.length} 張</dd></div><div><dt>填報人</dt><dd>${esc(p.submitterName)}</dd></div><div><dt>確認信 Email</dt><dd>${esc(p.submitterEmail)}</dd></div><div><dt>手機</dt><dd>${esc(p.submitterPhone || "未提供")}</dd></div></dl><h3>希望會內協助</h3><p class="summary-text">${esc(p.helpNeeded)}</p><p class="notice">資料只供授權領導團隊媒合與引薦，不對一般會員公開。</p><div class="row wrap"><button class="btn" data-action="close-modal">返回修改</button><button class="btn primary" id="confirm-submit">確認送出 →</button></div>`,
    );
    $("#confirm-submit").onclick = async () => {
      closeModal();
      await persistCase(p, $("#case-form"));
    };
  }
  async function persistCase(payload, form) {
    state.busy = true;
    const button = $("#submit-case");
    button.disabled = true;
    $("#form-error").hidden = true;
    const progress = $("#form-progress");
    try {
      if (state.editing) {
        await api("editCase", {
          id: state.editing.id,
          changes: payload,
          reason: new FormData(form).get("reason"),
        });
        toast("案件已更新，等待重新審核。");
        state.editing = null;
        await navigate("review");
        return;
      }
      if (!state.submission) {
        progress.textContent = "正在建立案件…";
        const data = await api("createCase", {
          ...payload,
          idempotencyKey:
            form.dataset.requestKey ||
            (form.dataset.requestKey = crypto.randomUUID()),
        });
        const c = data.case || data;
        state.submission = {
          id: c.id,
          receiptToken: c.receiptToken || data.receiptToken,
          uploaded: new Set(),
          title: payload.title,
        };
      }
      for (let i = 0; i < state.files.length; i++) {
        if (state.submission.uploaded.has(i)) continue;
        const f = state.files[i];
        progress.textContent = `正在上傳第 ${i + 1}／${state.files.length} 張圖片，請保留此頁…`;
        const base64 = await readBase64(f);
        const thumbnailBase64 = await makeThumbnail(f);
        await api("uploadImage", {
          caseId: state.submission.id,
          receiptToken: state.submission.receiptToken,
          fileName: f.name,
          mimeType: f.type,
          base64,
          thumbnailBase64,
          thumbnailMimeType: "image/jpeg",
          idempotencyKey: `${state.submission.id}-image-${i}`,
        });
        state.submission.uploaded.add(i);
      }
      progress.textContent = "正在送交九長審核…";
      const result = await api("finalizeCase", {
        id: state.submission.id,
        receiptToken: state.submission.receiptToken,
      });
      const id = state.submission.id;
      const submitted = result.case || {
        id,
        title: payload.title,
        submitterName: payload.submitterName,
        submitterEmail: payload.submitterEmail,
        submitterPhone: payload.submitterPhone,
      };
      const receiptUrl = safeReceiptUrl(result.receiptUrl);
      const emailMessage =
        result.emailStatus === "sent"
          ? `確認信已寄至 ${payload.submitterEmail}，信中包含這筆物件的專屬連結。`
          : result.emailStatus === "demo_not_sent" ||
              result.emailStatus === "local_preview"
            ? "目前為示範環境，不會寄出真實 Email；可使用下方連結查看本次登錄。"
            : "需求已保存，但確認信尚未寄出。請先保存下方連結或案件編號，必要時聯絡資訊組。";
      state.submission = null;
      state.files = [];
      state.view = "success";
      shell(
        `<section class="panel success-panel"><div class="success-icon">✓</div><h1>需求已登錄</h1><p class="muted">領導團隊將協助盤點、媒合與引薦。</p><dl class="detail-meta"><div><dt>物件</dt><dd>${esc(submitted.title)}</dd></div><div><dt>填報人</dt><dd>${esc(submitted.submitterName)}</dd></div><div><dt>Email</dt><dd>${esc(submitted.submitterEmail)}</dd></div><div><dt>手機</dt><dd>${esc(submitted.submitterPhone || "未提供")}</dd></div><div><dt>案件編號</dt><dd>${esc(id)}</dd></div></dl><p class="notice ${result.emailStatus === "sent" ? "info" : ""}">${esc(emailMessage)}</p><div class="row wrap" style="justify-content:center">${receiptUrl ? `<a class="btn" href="${esc(receiptUrl)}" rel="noreferrer">查看本次登錄</a>` : ""}<button class="btn primary" data-view="new">再登錄一筆</button></div></section>`,
      );
    } catch (e) {
      $("#form-error").textContent =
        e.message +
        (state.submission
          ? " 已成功上傳的圖片會保留，請按「繼續上傳與送審」重試。"
          : "");
      $("#form-error").hidden = false;
      if (state.submission) button.textContent = "繼續上傳與送審";
    } finally {
      state.busy = false;
      if (button.isConnected) button.disabled = false;
    }
  }
  async function makeThumbnail(file) {
    const bitmap = await createImageBitmap(file);
    try {
      const scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/jpeg", 0.78).split(",")[1];
    } finally {
      bitmap.close();
    }
  }
  function readBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1]);
      reader.onerror = () => reject(new Error("圖片讀取失敗，請重新選擇。"));
      reader.readAsDataURL(file);
    });
  }
  async function loadCases() {
    if (!staff()) {
      state.cases = [];
      return;
    }
    const data = await api("listCases", {});
    state.cases = data.cases || [];
  }
  async function navigate(view) {
    if (!staff() && !["new", "success", "receipt"].includes(view)) view = "new";
    if (state.busy) return;
    if (state.submission && view !== "new") {
      if (
        !confirm(
          "尚有未完成的上傳，離開後需要聯絡資訊組處理這筆草稿。確定離開？",
        )
      )
        return;
      state.submission = null;
    }
    closeModal();
    state.view = view;
    state.query = "";
    state.category = "";
    state.status = "";
    if (view === "new") {
      state.files = [];
      renderForm();
    } else if (view === "users") {
      if (!info()) return;
      await renderUsers();
    } else {
      shell(
        '<div class="skeleton"></div><p class="hint" style="margin-top:15px">正在讀取案件…</p>',
      );
      try {
        await loadCases();
        if (view === "overview") renderOverview();
        else if (view === "review" && staff()) renderReview();
        else renderCases();
      } catch (e) {
        shell(
          `<div class="notice error">${esc(e.message)}</div><button class="btn" data-action="refresh" style="margin-top:20px">重新讀取</button>`,
        );
      }
    }
    window.scrollTo(0, 0);
  }
  function openModal(title, body) {
    lastFocus = document.activeElement;
    $("#modal-root").innerHTML =
      `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="dialog-title" tabindex="-1"><header class="modal-head"><h2 id="dialog-title">${title}</h2><button class="close-btn" aria-label="關閉視窗" data-action="close-modal">×</button></header><div class="modal-body">${body}</div></section></div>`;
    document.body.style.overflow = "hidden";
    $(".modal").focus();
  }
  function closeModal() {
    if (!$("#modal-root").innerHTML) return;
    $("#modal-root").innerHTML = "";
    document.body.style.overflow = "";
    if (lastFocus?.isConnected) lastFocus.focus();
  }
  async function showCase(id) {
    if (!staff()) {
      toast("僅限授權領導團隊查看案件。", true);
      return;
    }
    openModal(
      "案件詳情",
      '<div class="skeleton"></div><p class="hint">正在讀取案件…</p>',
    );
    try {
      const result = await api("getCase", { id });
      state.detail = result.case || result;
      const c = state.detail;
      $(".modal-body").innerHTML =
        `<div class="row spread wrap"><div class="row wrap">${(c.categories || []).map((x) => `<span class="tag wine">${esc(x)}</span>`).join("")}</div>${badge(c.status)}</div><h2 class="detail-title">${esc(c.title)}</h2><p class="hint">案件編號 ${esc(c.id)}　·　${date(c.updatedAt || c.createdAt)} 更新</p><dl class="detail-meta">${[
          ["標的類型", c.propertyType],
          ["地區", [c.city, c.district].filter(Boolean).join(" ")],
          ["提報會員", c.memberName || c.memberId],
          ["Email", c.submitterEmail || c.contact],
          ["手機", c.submitterPhone || "未提供"],
          ["詳細位置", c.location || "未提供"],
          [
            "提報關係",
            (c.onBehalf ? "代他人提報 · " : "") + (c.relationship || "未提供"),
          ],
        ]
          .map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`)
          .join("")}</dl>${[
          ["會內摘要", c.summary],
          ["現況與需求", c.description],
          ["希望會內協助", c.helpNeeded],
        ]
          .filter((x) => x[1])
          .map(
            ([h, t]) =>
              `<section class="detail-section"><h3>${h}</h3><div class="summary-text">${esc(t)}</div></section>`,
          )
          .join(
            "",
          )}<section class="detail-section"><h3>相關圖片 <span class="hint">${c.images?.length || 0} 張</span></h3>${c.images?.length ? `<div class="detail-images">${c.images.map((im) => `<div class="detail-image"><img data-image="${esc(im.id)}" alt="${esc(im.fileName || "物件圖片")}">${staff() ? `<label class="checkbox-line"><input class="approve-image" type="checkbox" value="${esc(im.id)}" ${im.approved !== false ? "checked" : ""}>供領導團隊查看</label>` : ""}</div>`).join("")}</div>` : '<p class="hint">此案件未提供圖片。</p>'}</section><div class="row wrap"><button class="btn small" data-action="download-case">↓ 完整案件資料</button>${c.images?.length ? '<button class="btn small" data-action="download-images">↓ 原圖 ZIP</button>' : ""}</div>${staff() ? `<section class="review-panel"><h3>媒合與引薦紀錄</h3><p class="hint">以下內容僅供授權領導團隊查看。</p>${field("review-summary", "需求摘要", { textarea: true, value: c.summary || c.helpNeeded })}${field("review-notes", "內部盤點備註", { textarea: true, value: "", placeholder: "媒合對象、引薦進度、後續窗口與下一步" })}<div id="review-error" class="notice error" role="alert" hidden></div>${(c.internalNotes || []).length ? '<div class="hint">' + c.internalNotes.map((n) => "<p><strong>" + esc(n.actor) + " · " + date(n.at) + "</strong><br>" + esc(n.text) + "</p>").join("") + "</div>" : ""}<div class="review-actions">${["pending", "needs_info"].includes(c.status) ? '<button class="btn primary" data-action="publish">完成評估</button><button class="btn" data-action="needs-info">要求補充資料</button>' : ""}<button class="btn" data-action="save-note">儲存盤點備註</button></div>${info() ? `<div class="divider"></div><h3>資訊組案件管理</h3>${field("change-reason", "異動原因", { placeholder: "修改、撤回、失效及封存時必填" })}<div class="review-actions"><button class="btn small" data-action="edit-case">修改內容</button><button class="btn small" data-action="withdraw">撤回</button><button class="btn small" data-action="expire">標記失效</button><button class="btn small danger" data-action="archive">封存案件</button></div>` : ""}</section>` : ""}`;
      hydrateImages($(".modal-body"));
    } catch (e) {
      $(".modal-body").innerHTML =
        `<p class="notice error">${esc(e.message)}</p>`;
    }
  }
  async function hydrateImages(root = document) {
    for (const node of $$("[data-image]", root)) {
      const id = node.dataset.image;
      try {
        const d = await api("getImage", { id, original: false });
        if (node.isConnected)
          node.src = `data:${d.mimeType};base64,${d.base64}`;
      } catch {
        if (node.isConnected) {
          node.alt = "圖片暫時無法載入";
          node.style.padding = "15px";
        }
      }
    }
  }
  function saveFile(content, name, type = "application/octet-stream") {
    const blob =
      content instanceof Blob ? content : new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  function downloadCase() {
    if (!staff()) return;
    const c = state.detail;
    const out = {
      案件編號: c.id,
      案件名稱: c.title,
      標的類型: c.propertyType,
      需求: c.categories,
      縣市: c.city,
      行政區: c.district,
      位置: c.location,
      提報人: c.memberName || c.memberId,
      聯絡方式: c.contact,
      是否代他人提報: c.onBehalf === true,
      與標的關係: c.relationship || "",
      摘要: c.summary,
      現況與需求: c.description,
      希望協助: c.helpNeeded,
      圖片: (c.images || []).map((i) => ({ 檔名: i.fileName, 圖片編號: i.id })),
      狀態: statusNames[c.status],
      建立時間: c.createdAt,
      更新時間: c.updatedAt,
    };
    saveFile(
      JSON.stringify(out, null, 2),
      `${safeName(c.title)}-完整資料.json`,
      "application/json;charset=utf-8",
    );
    toast("已下載核准範圍的案件資料。");
  }
  const safeName = (s) =>
    String(s || "案件")
      .replace(/[\\/:*?"<>|\x00-\x1f]/g, "_")
      .slice(0, 70);
  async function downloadImages() {
    const c = state.detail;
    toast("正在整理原圖，請稍候…");
    const files = [];
    for (let i = 0; i < (c.images || []).length; i++) {
      const d = await api("getImage", { id: c.images[i].id, original: true });
      files.push({
        name: `${String(i + 1).padStart(2, "0")}-${safeName(d.fileName)}`,
        bytes: Uint8Array.from(atob(d.base64), (x) => x.charCodeAt(0)),
      });
    }
    saveFile(makeZip(files), `${safeName(c.title)}-原圖.zip`);
    toast("原圖 ZIP 已下載。");
  }
  function makeZip(files) {
    const enc = new TextEncoder();
    let offset = 0;
    const chunks = [],
      central = [];
    const table = Array.from({ length: 256 }, (_, n) => {
      let c = n;
      for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      return c >>> 0;
    });
    for (const f of files) {
      const name = enc.encode(f.name),
        bytes = f.bytes;
      let crc = 0xffffffff;
      for (const b of bytes) crc = table[(crc ^ b) & 255] ^ (crc >>> 8);
      crc = (crc ^ 0xffffffff) >>> 0;
      const local = new Uint8Array(30 + name.length),
        v = new DataView(local.buffer);
      v.setUint32(0, 0x04034b50, true);
      v.setUint16(4, 20, true);
      v.setUint16(6, 0x800, true);
      v.setUint32(14, crc, true);
      v.setUint32(18, bytes.length, true);
      v.setUint32(22, bytes.length, true);
      v.setUint16(26, name.length, true);
      local.set(name, 30);
      const cd = new Uint8Array(46 + name.length),
        cv = new DataView(cd.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x800, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, bytes.length, true);
      cv.setUint32(24, bytes.length, true);
      cv.setUint16(28, name.length, true);
      cv.setUint32(42, offset, true);
      cd.set(name, 46);
      chunks.push(local, bytes);
      central.push(cd);
      offset += local.length + bytes.length;
    }
    const size = central.reduce((n, c) => n + c.length, 0),
      end = new Uint8Array(22),
      ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, size, true);
    ev.setUint32(16, offset, true);
    return new Blob([...chunks, ...central, end], { type: "application/zip" });
  }
  async function review(decision) {
    const summary = $("#review-summary").value.trim(),
      notes = $("#review-notes").value.trim();
    if (decision === "publish" && !summary) {
      toast("請先填寫需求摘要。", true);
      return;
    }
    await api("reviewCase", {
      id: state.detail.id,
      decision,
      summary,
      notes,
      approvedImageIds: $$(".approve-image:checked").map((x) => x.value),
    });
    toast(decision === "publish" ? "需求已完成評估。" : "已標記為待補充資料。");
    closeModal();
    await navigate(state.view);
  }
  async function renderUsers() {
    shell(
      `${pageHead("ACCESS MANAGEMENT", "管理帳號", "九長與資訊組使用個別帳號；會內會員使用共用密碼。")}<div class="skeleton"></div>`,
    );
    try {
      const data = await api("listAdminUsers");
      shell(
        `${pageHead("ACCESS MANAGEMENT", "管理帳號", "九長與資訊組使用個別帳號；會內會員使用共用密碼。")}<div class="admin-user-grid"><section class="panel"><h2 style="font-size:16px">現有管理者</h2><div class="table-wrap"><table><thead><tr><th>帳號</th><th>權限</th><th>狀態</th></tr></thead><tbody>${(data.users || []).map((u) => `<tr><td><strong>${esc(u.displayName)}</strong>${esc(u.username)}</td><td>${esc(roleName(u.role))}</td><td>${u.active ? "啟用" : "停用"}</td></tr>`).join("")}</tbody></table></div></section><section class="panel"><h2 style="font-size:16px">新增或更新管理者</h2><form id="admin-form">${field("adminUsername", "帳號", { required: true, placeholder: "英數字帳號" })}${field("adminDisplayName", "顯示名稱", { required: true })}${field(
          "adminRole",
          "權限",
          {
            required: true,
            options: [
              { value: "reviewer", label: "九長" },
              { value: "info", label: "資訊組" },
            ],
          },
        )}${field("adminPassword", "新密碼", { type: "password", hint: "新增帳號必填，更新時留白代表不變更密碼。至少 12 個字元。" })}<label class="checkbox-line"><input type="checkbox" name="active" checked>啟用此帳號</label><button class="btn primary" style="margin-top:20px" type="submit">儲存管理者</button></form></section></div>`,
      );
    } catch (e) {
      toast(e.message, true);
    }
  }
  document.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      if (f.id === "login-form") {
        const b = $("button[type=submit]", f);
        b.disabled = true;
        b.textContent = "登入中…";
        try {
          const fd = new FormData(f);
          const data = await api("login", {
            mode: "admin",
            username: fd.get("username") || "",
            password: fd.get("password"),
          });
          state.token = data.token;
          state.user = data;
          sessionStorage.setItem(sessionKey, data.token);
          await boot();
        } catch (err) {
          renderLogin(err.message);
        }
      } else if (f.id === "case-form") await submitCase(f);
      else if (f.id === "admin-form") {
        const fd = new FormData(f);
        await api("saveAdminUser", {
          username: fd.get("adminUsername").trim(),
          displayName: fd.get("adminDisplayName").trim(),
          role: fd.get("adminRole"),
          password: fd.get("adminPassword"),
          active: fd.has("active"),
        });
        toast("管理帳號已儲存。");
        await renderUsers();
      }
    } catch (err) {
      toast(err.message, true);
    }
  });
  document.addEventListener("click", async (e) => {
    const b = e.target.closest("button,[data-view],[data-case]");
    if (!b) return;
    if (b.dataset.loginMode) {
      state.loginMode = b.dataset.loginMode;
      renderLogin();
      return;
    }
    if (b.dataset.view) {
      await navigate(b.dataset.view);
      return;
    }
    if (b.dataset.case) {
      await showCase(b.dataset.case);
      return;
    }
    if (b.dataset.removeImage !== undefined) {
      state.files.splice(Number(b.dataset.removeImage), 1);
      renderPreviews();
      return;
    }
    const action = b.dataset.action;
    if (action === "google-login") {
      try {
        const result = await api("googleLogin", {});
        state.token = result.token;
        state.user = result;
        sessionStorage.setItem(sessionKey, result.token);
        await boot();
      } catch (error) {
        renderLogin(error.message);
      }
      return;
    }
    if (action === "reset-demo") {
      if (
        confirm(
          "只會重置此瀏覽器的虛構示範資料，不影響任何正式案件。確定重置？",
        )
      ) {
        await api("resetDemo");
        await navigate("overview");
        toast("示範資料已重置。");
      }
      return;
    }
    if (!action) return;
    try {
      if (action === "logout" && reviewAdapter) {
        const data = await api("login", { mode: "review", role: "member" });
        state.token = data.token;
        state.user = data;
        sessionStorage.setItem(sessionKey, data.token);
        await navigate("overview");
        toast("已回到夥伴審閱視角。");
        return;
      }
      if (action === "logout") {
        await api("logout");
        state.token = "";
        state.user = null;
        sessionStorage.removeItem(sessionKey);
        renderLogin();
      }
      if (action === "menu") {
        const open = $(".sidebar").classList.toggle("open");
        b.setAttribute("aria-expanded", String(open));
      }
      if (action === "close-modal") closeModal();
      if (action === "refresh") await navigate(state.view);
      if (action === "export") {
        const d = await api("exportCases", {
          query: state.query,
          category: state.category,
          status: state.view === "review" ? state.status : "published",
        });
        saveFile(
          d.csv,
          d.fileName || "華都更案件清單.csv",
          "text/csv;charset=utf-8",
        );
        toast("清單已下載。");
      }
      if (action === "download-case") downloadCase();
      if (action === "download-images") {
        b.disabled = true;
        await downloadImages();
      }
      if (action === "publish" || action === "needs-info") {
        b.disabled = true;
        await review(action === "publish" ? "publish" : "needs_info");
      }
      if (action === "save-note") {
        await api("addNote", {
          id: state.detail.id,
          notes: $("#review-notes").value.trim(),
        });
        toast("盤點備註已儲存。");
      }
      if (["edit-case", "withdraw", "expire", "archive"].includes(action)) {
        const reason = $("#change-reason").value.trim();
        if (!reason) {
          $("#change-reason").focus();
          toast("請先填寫異動原因。", true);
          return;
        }
        if (action === "edit-case") {
          const c = { ...state.detail };
          closeModal();
          state.view = "new";
          state.files = [];
          renderForm(c);
          $("#reason").value = reason;
        } else {
          if (
            !confirm(
              action === "archive"
                ? "封存後不對會員顯示，資料仍保留。確定封存？"
                : "確定變更此案件狀態？",
            )
          )
            return;
          if (action === "archive")
            await api("removeCase", { id: state.detail.id, reason });
          else
            await api("changeStatus", {
              id: state.detail.id,
              status: action === "withdraw" ? "withdrawn" : "expired",
              reason,
            });
          toast("案件狀態已更新。");
          closeModal();
          await navigate(state.view);
        }
      }
    } catch (err) {
      toast(err.message, true);
    } finally {
      if (b.isConnected) b.disabled = false;
    }
  });
  document.addEventListener("input", (e) => {
    if (e.target.id === "case-search") {
      state.query = e.target.value;
      if (state.view === "review")
        $("#review-results").innerHTML = reviewResults();
      else {
        $("#results").innerHTML = caseResults();
        hydrateImages($("#results"));
      }
    }
  });
  document.addEventListener("change", (e) => {
    if (e.target.id === "images") addFiles([...e.target.files]);
    if (e.target.id === "category-filter" || e.target.id === "status-filter") {
      state.category = $("#category-filter")?.value || "";
      state.status = $("#status-filter")?.value || "";
      if (state.view === "review")
        $("#review-results").innerHTML = reviewResults();
      else {
        $("#results").innerHTML = caseResults();
        hydrateImages($("#results"));
      }
    }
  });
  document.addEventListener("keydown", (e) => {
    const modal = $(".modal");
    if (!modal) return;
    if (e.key === "Escape") closeModal();
    if (e.key === "Tab") {
      const els = $$("button,input,select,textarea,a[href]", modal).filter(
        (x) => !x.disabled && !x.hidden,
      );
      if (!els.length) return;
      if (
        e.shiftKey &&
        (document.activeElement === els[0] || document.activeElement === modal)
      ) {
        e.preventDefault();
        els.at(-1).focus();
      } else if (!e.shiftKey && document.activeElement === els.at(-1)) {
        e.preventDefault();
        els[0].focus();
      }
    }
  });
  window.addEventListener("beforeunload", (e) => {
    if (state.submission || state.busy) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
  function safeReceiptUrl(value) {
    if (!value) return "";
    try {
      const u = new URL(value, location.href);
      if (!["https:", "http:"].includes(u.protocol)) return "";
      if (u.origin === location.origin) return u.href;
      if (
        u.origin === "https://script.google.com" &&
        /^\/macros\/s\/[^/]+\/exec$/.test(u.pathname)
      )
        return u.href;
      return "";
    } catch {
      return "";
    }
  }
  async function renderReceipt(token) {
    state.view = "receipt";
    state.user = null;
    shell('<div class="panel"><p>正在讀取本次登錄…</p></div>');
    try {
      const data = await api("getReceipt", { receiptToken: token });
      const c = data.case || data;
      shell(
        `${pageHead("", "本次需求登錄", "此連結只供查看本次填報內容，請妥善保管。")}<article class="panel receipt-detail"><h2>${esc(c.title)}</h2><div class="row wrap">${(c.categories || []).map((x) => `<span class="tag wine">${esc(x)}</span>`).join("")}</div><dl class="detail-meta">${[
          ["填報人", c.submitterName || c.memberName],
          ["Email", c.submitterEmail || c.contact],
          ["手機", c.submitterPhone || "未提供"],
          ["案件編號", c.id],
          ["標的類型", c.propertyType],
          ["地區", [c.city, c.district].filter(Boolean).join(" ")],
          ["詳細位置", c.location || "未提供"],
        ]
          .map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`)
          .join("")}</dl>${[
          ["現況與需求", c.description],
          ["希望協助", c.helpNeeded],
        ]
          .map(
            ([h, t]) =>
              `<section class="detail-section"><h3>${h}</h3><p class="summary-text">${esc(t)}</p></section>`,
          )
          .join(
            "",
          )}${c.images?.length ? `<section class="detail-section"><h3>本次上傳圖片</h3><div class="detail-images">${c.images.map((im) => `<div class="detail-image"><img data-receipt-image="${esc(im.id)}" alt="${esc(im.fileName || "物件圖片")}"></div>`).join("")}</div></section>` : ""}<p class="hint">如需補充、修改或撤回，請將案件編號提供給資訊組。</p><a class="btn" href="https://hua-urban.com/">回華都更首頁</a></article>`,
      );
      for (const node of $$("[data-receipt-image]")) {
        try {
          const image = await api("getReceiptImage", {
            receiptToken: token,
            id: node.dataset.receiptImage,
            original: false,
          });
          node.src = `data:${image.mimeType};base64,${image.base64}`;
        } catch {
          node.alt = "圖片目前無法載入";
        }
      }
    } catch (error) {
      shell(
        `<section class="panel"><h1>無法開啟此物件</h1><p class="notice error">${esc(error.message)}</p><p class="hint">請確認使用確認信中的完整連結，或聯絡資訊組。</p></section>`,
      );
    }
  }
  async function boot() {
    const rawReceipt =
      [
        document.body.dataset.receiptToken,
        new URLSearchParams(location.hash.slice(1)).get("receipt"),
      ].find((value) => /^[A-Za-z0-9_-]{32,128}$/.test(value || "")) || "";
    if (/^[A-Za-z0-9_-]{32,128}$/.test(rawReceipt)) {
      state.receiptToken = rawReceipt;
      await renderReceipt(rawReceipt);
      return;
    }
    if (!gas && !reviewAdapter && !publicAdapter) {
      try {
        const h = await fetch("/api/health").then((r) => r.json());
        state.environment = h.data?.environment || "local";
      } catch {}
    }
    if (adminEntry && !state.token) {
      if (gas) {
        try {
          const data = await api("googleLogin", {});
          state.token = data.token;
          state.user = data;
          sessionStorage.setItem(sessionKey, data.token);
        } catch (error) {
          renderLogin(error.message);
          return;
        }
      } else {
        renderLogin(
          reviewAdapter ? "請由官網後臺使用已授權的 Google 帳戶登入。" : "",
        );
        return;
      }
    }
    if (!adminEntry && !state.token) {
      const data = await api("startSubmission", {});
      state.token = data.token;
      state.user = data;
      sessionStorage.setItem(sessionKey, data.token);
    }
    try {
      const data = await api("bootstrap");
      state.user = { ...state.user, ...data.user };
      state.environment = data.environment || state.environment;
      state.members = data.members || [];
      await navigate(staff() ? "review" : "new");
    } catch (error) {
      state.token = "";
      sessionStorage.removeItem(sessionKey);
      if (adminEntry) {
        renderLogin(error.message);
      } else if (["UNAUTHORIZED", "SESSION_EXPIRED", "AUTH_REQUIRED"].includes(error.code)) {
        const started = await api("startSubmission", {});
        state.token = started.token;
        sessionStorage.setItem(sessionKey, started.token);
        const fresh = await api("bootstrap");
        state.user = { ...started, ...fresh.user };
        state.members = fresh.members || [];
        await navigate("new");
      } else throw error;
    }
  }
  window.addEventListener("hashchange", () => {
    const token = new URLSearchParams(location.hash.slice(1)).get("receipt");
    if (/^[A-Za-z0-9_-]{32,128}$/.test(token || "")) renderReceipt(token);
  });
  boot().catch((error) => {
    $("#app").innerHTML =
      `<main id="main" class="loading-page">${brandMark()}<h1 style="font-size:22px">目前無法開啟平台</h1><p class="notice error">${esc(error.message || "請確認瀏覽器允許儲存資料，或改用一般瀏覽模式後重試。")}</p><button class="btn" id="retry-start">重新載入</button></main>`;
    $("#retry-start").onclick = () => location.reload();
  });
})();
