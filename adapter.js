/* Public Director review. All records and photos stay in this browser's IndexedDB.
 * Role tokens simulate workflows; they are intentionally not authentication.
 * This adapter never calls a network endpoint or any production data source.
 */
(function () {
  "use strict";
  const DB_NAME = "huadu-public-review-v1";
  const TOKENS = {
    "review-member": "member",
    "review-reviewer": "reviewer",
    "review-info": "info",
  };
  const LABELS = {
    member: "【示範】會員",
    reviewer: "【示範】審核人員",
    info: "【示範】資訊組",
  };
  const CATEGORIES = ["整合", "出售", "出租", "貸款活化"];
  const MEMBERS = [
    {
      memberId: "review-m001",
      memberNo: "DEMO001",
      name: "【示範】會員甲（虛構）",
    },
    {
      memberId: "review-m002",
      memberNo: "DEMO002",
      name: "【示範】會員乙（虛構）",
    },
    {
      memberId: "review-m003",
      memberNo: "DEMO003",
      name: "【示範】會員丙（虛構）",
    },
  ];
  const uid = () => crypto.randomUUID();
  const now = () => new Date().toISOString();
  const clean = (s, max = 2000) =>
    typeof s === "string" ? s.trim().slice(0, max) : "";
  const fail = (message, code = "INVALID_REQUEST") => {
    const e = new Error(message);
    e.code = code;
    throw e;
  };
  const required = (p, k, max) => clean(p[k], max) || fail(`請填寫 ${k}`);
  function seed() {
    const time = now();
    return {
      version: 1,
      members: MEMBERS,
      users: [
        {
          username: "reviewer",
          displayName: LABELS.reviewer,
          role: "reviewer",
          active: true,
        },
        {
          username: "info",
          displayName: LABELS.info,
          role: "info",
          active: true,
        },
      ],
      images: [],
      cases: CATEGORIES.map((category, index) => ({
        id: "review-case-" + (index + 1),
        title: [
          "【示範】街廓整合需求（虛構）",
          "【示範】住宅出售協作（虛構）",
          "【示範】店面出租需求（虛構）",
          "【示範】土地貸款活化（虛構・待審）",
        ][index],
        memberId: MEMBERS[index % 3].memberId,
        memberName: MEMBERS[index % 3].name,
        contact: "【示範】此為虛構聯絡方式，請勿聯繫",
        propertyType: index === 3 ? "土地" : "房屋",
        city: ["臺北市", "新北市", "桃園市", "新竹縣"][index],
        district: ["中山區", "板橋區", "中壢區", "竹北市"][index],
        location: "【示範】虛構地址，不對應真實物件",
        categories: [category],
        description:
          "【示範】本筆為董顧審閱流程用的完全虛構情境，沒有真實會員、地址、委託、案件或照片。請以此體驗提案與審核操作。",
        helpNeeded:
          "【示範】希望了解" +
          category +
          "的協作處理流程；所有內容僅供畫面與流程審閱。",
        onBehalf: false,
        relationship: "",
        summary: index === 3 ? "" : "【示範】虛構案件審核摘要，僅供公開預覽。",
        shareConsent: true,
        status: index === 3 ? "pending" : "published",
        createdAt: time,
        updatedAt: time,
        createdSessionId: "seed-only",
        receiptToken: uid(),
        idempotencyKey: "seed-" + index,
        internalNotes:
          index === 3
            ? [
                {
                  at: time,
                  actor: LABELS.reviewer,
                  text: "【示範】此為內部審核備註，會員視角不顯示。",
                },
              ]
            : [],
        reviewHistory: [],
      })),
    };
  }
  let opened;
  function openDB() {
    if (!opened)
      opened = new Promise((resolve, reject) => {
        if (!window.indexedDB)
          return reject(new Error("瀏覽器不支援 IndexedDB"));
        const r = indexedDB.open(DB_NAME, 1);
        r.onupgradeneeded = () => r.result.createObjectStore("state");
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
        r.onblocked = () => reject(new Error("示範資料庫被其他分頁阻擋"));
      });
    return opened;
  }
  async function read() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("state", "readonly"),
        r = tx.objectStore("state").get("data");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  async function write(data) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("state", "readwrite");
      tx.objectStore("state").put(data, "data");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("示範儲存失敗"));
    });
  }
  const staff = (role) => role === "reviewer" || role === "info";
  const demandStaff = (role) => {
    if (!staff(role)) fail("此示範操作需要審核人員角色", "FORBIDDEN");
  };
  const demandInfo = (role) => {
    if (role !== "info") fail("此示範操作需要資訊組角色", "FORBIDDEN");
  };
  const imageView = (i) => {
    const { base64, thumbnailBase64, idempotencyKey, ...out } = i;
    return out;
  };
  function view(c, role, receipt = false) {
    const {
      receiptToken,
      createdSessionId,
      idempotencyKey,
      internalNotes,
      ...out
    } = structuredClone(c);
    out.images = current.images
      .filter(
        (i) =>
          i.caseId === c.id &&
          (staff(role) || c.createdSessionId === "review-member" || i.approved),
      )
      .map(imageView);
    if (staff(role)) out.internalNotes = internalNotes;
    if (receipt) out.receiptToken = receiptToken;
    return out;
  }
  let current;
  function validate(p) {
    const m = current.members.find((m) => m.memberId === p.memberId);
    if (!m) fail("請選擇示範會員");
    if (!["房屋", "土地", "其他"].includes(p.propertyType))
      fail("請選擇有效物件類型");
    if (
      !Array.isArray(p.categories) ||
      !p.categories.length ||
      p.categories.some((v) => !CATEGORIES.includes(v))
    )
      fail("請選擇有效需求分類");
    if (p.shareConsent !== true) fail("請先勾選分享同意");
    if (p.onBehalf === true && !clean(p.relationship))
      fail("代填時請說明關係與授權");
    return {
      title: required(p, "title", 120),
      memberId: m.memberId,
      memberName: m.name,
      contact: required(p, "contact", 300),
      propertyType: p.propertyType,
      city: required(p, "city", 40),
      district: required(p, "district", 40),
      location: clean(p.location, 200),
      categories: [...new Set(p.categories)],
      description: required(p, "description", 10000),
      helpNeeded: required(p, "helpNeeded", 5000),
      onBehalf: p.onBehalf === true,
      relationship: clean(p.relationship, 500),
      summary: clean(p.summary),
      shareConsent: true,
    };
  }
  function checkImage(base64, mime, max = 26214400) {
    if (
      !["image/png", "image/jpeg"].includes(mime) ||
      typeof base64 !== "string" ||
      !base64.length ||
      base64.length % 4 !== 0 ||
      base64.length > Math.ceil(max / 3) * 4 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)
    )
      fail("請選擇大小符合限制的 JPEG 或 PNG 圖片", "INVALID_IMAGE");
    let raw;
    try {
      raw = atob(base64);
    } catch {
      fail("圖片編碼無效", "INVALID_IMAGE");
    }
    if (raw.length > max) fail("圖片超過大小限制", "INVALID_IMAGE");
    const b = (i) => raw.charCodeAt(i);
    if (
      mime === "image/png" &&
      !(
        raw.length >= 33 &&
        [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => b(i) === v) &&
        raw.slice(12, 16) === "IHDR"
      )
    )
      fail("PNG 圖片內容無效", "INVALID_IMAGE");
    if (
      mime === "image/jpeg" &&
      !(
        raw.length >= 12 &&
        b(0) === 255 &&
        b(1) === 216 &&
        b(2) === 255 &&
        b(raw.length - 2) === 255 &&
        b(raw.length - 1) === 217
      )
    )
      fail("JPEG 圖片內容無效", "INVALID_IMAGE");
    return raw.length;
  }
  function find(id) {
    return (
      current.cases.find((c) => c.id === id) ||
      fail("找不到示範案件", "NOT_FOUND")
    );
  }
  function filtered(p, role) {
    return current.cases
      .filter(
        (c) =>
          (staff(role)
            ? p.status
              ? c.status === p.status
              : c.status !== "deleted"
            : c.status === "published") &&
          (!p.category || c.categories.includes(p.category)) &&
          (!p.query ||
            [
              c.title,
              c.memberName,
              c.city,
              c.district,
              c.location,
              c.description,
              c.summary,
            ]
              .join(" ")
              .toLowerCase()
              .includes(clean(p.query).toLowerCase())),
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async function dispatch(request) {
    const { action, payload: p = {}, token } = request || {};
    if (!p || typeof p !== "object" || Array.isArray(p)) fail("請求格式無效");
    current = await read();
    if (!current) {
      current = seed();
      await write(current);
    }
    if (action === "login") {
      let role;
      if (p.mode === "review") role = p.role;
      else if (p.mode === "member") role = "member";
      else if (p.mode === "admin")
        role = current.users.find(
          (u) => u.active && u.username === p.username,
        )?.role;
      if (!["member", "reviewer", "info"].includes(role))
        fail("請選擇有效的示範角色", "UNAUTHORIZED");
      return {
        token: "review-" + role,
        role,
        displayName: LABELS[role],
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      };
    }
    const role = TOKENS[token];
    if (!role) fail("請先進入示範角色", "UNAUTHORIZED");
    if (action === "logout") return { loggedOut: true };
    if (action === "bootstrap")
      return {
        environment: "review",
        members: current.members,
        user: { role, displayName: LABELS[role] },
      };
    if (action === "resetDemo") {
      current = seed();
      await write(current);
      return { reset: true };
    }
    if (action === "listCases")
      return { cases: filtered(p, role).map((c) => view(c, role)) };
    if (action === "getCase") {
      const c = find(p.id);
      if (
        !staff(role) &&
        c.status !== "published" &&
        !(
          c.status !== "deleted" &&
          (c.createdSessionId === token ||
            (p.receiptToken && p.receiptToken === c.receiptToken))
        )
      )
        fail("請切換審核角色查看此示範案件", "FORBIDDEN");
      return { case: view(c, role) };
    }
    if (action === "createCase") {
      const key = required(p, "idempotencyKey", 200),
        old = current.cases.find(
          (c) => c.idempotencyKey === key && c.createdSessionId === token,
        );
      if (old) return { case: view(old, role, true) };
      const c = {
        id: uid(),
        ...validate(p),
        status: "draft",
        createdAt: now(),
        updatedAt: now(),
        createdSessionId: token,
        receiptToken: uid(),
        idempotencyKey: key,
        internalNotes: [],
        reviewHistory: [],
      };
      current.cases.push(c);
      await write(current);
      return { case: view(c, role, true) };
    }
    if (action === "uploadImage") {
      const c = find(p.caseId);
      if (
        !staff(role) &&
        !(
          ["draft", "pending"].includes(c.status) &&
          (c.createdSessionId === token ||
            (p.receiptToken && p.receiptToken === c.receiptToken))
        )
      )
        fail("沒有此示範圖片的上傳權限", "FORBIDDEN");
      if (c.status === "deleted") fail("示範案件已移除");
      const key = p.idempotencyKey ? required(p, "idempotencyKey", 200) : "",
        old =
          key &&
          current.images.find(
            (i) => i.caseId === c.id && i.idempotencyKey === key,
          );
      if (old) return { image: imageView(old) };
      if (current.images.filter((i) => i.caseId === c.id).length >= 15)
        fail("每筆示範案件最多 15 張圖片");
      const fileName = required(p, "fileName", 160);
      if (
        /[\x00-\x1f\x7f<>:"/\\|?*]/.test(fileName) ||
        [".", ".."].includes(fileName)
      )
        fail("圖片檔名含不安全字元", "INVALID_IMAGE");
      const size = checkImage(p.base64, p.mimeType);
      if (p.thumbnailBase64 !== undefined)
        checkImage(p.thumbnailBase64, p.thumbnailMimeType, 2097152);
      const image = {
        id: uid(),
        caseId: c.id,
        fileName,
        mimeType: p.mimeType,
        base64: p.base64,
        size,
        approved: false,
        createdAt: now(),
        idempotencyKey: key,
        hasThumbnail: p.thumbnailBase64 !== undefined,
        ...(p.thumbnailBase64 !== undefined
          ? {
              thumbnailBase64: p.thumbnailBase64,
              thumbnailMimeType: p.thumbnailMimeType,
            }
          : {}),
      };
      current.images.push(image);
      if (c.status === "published") c.status = "pending";
      c.updatedAt = now();
      await write(current);
      return { image: imageView(image) };
    }
    if (action === "finalizeCase") {
      const c = find(p.id);
      if (
        c.createdSessionId !== token &&
        !(p.receiptToken && p.receiptToken === c.receiptToken)
      )
        fail("示範送出憑證無效", "FORBIDDEN");
      if (!["draft", "pending"].includes(c.status)) fail("案件目前無法送出");
      c.status = "pending";
      c.updatedAt = now();
      await write(current);
      return { case: view(c, role) };
    }
    if (action === "reviewCase") {
      demandStaff(role);
      const c = find(p.id);
      if (!["pending", "needs_info"].includes(c.status))
        fail("此示範案件不在待審核狀態");
      if (!["publish", "needs_info"].includes(p.decision)) fail("審核決定無效");
      const ids = p.approvedImageIds || [];
      if (
        !Array.isArray(ids) ||
        ids.some(
          (id) => !current.images.some((i) => i.id === id && i.caseId === c.id),
        )
      )
        fail("核准圖片清單無效");
      c.summary = required(p, "summary", 2000);
      c.status = p.decision === "publish" ? "published" : "needs_info";
      c.updatedAt = now();
      c.reviewHistory.push({
        at: now(),
        actor: LABELS[role],
        decision: p.decision,
      });
      current.images
        .filter((i) => i.caseId === c.id)
        .forEach((i) => (i.approved = ids.includes(i.id)));
      if (clean(p.notes))
        c.internalNotes.push({
          at: now(),
          actor: LABELS[role],
          text: clean(p.notes, 10000),
        });
      await write(current);
      return { case: view(c, role) };
    }
    if (action === "addNote") {
      demandStaff(role);
      const c = find(p.id);
      c.internalNotes.push({
        at: now(),
        actor: LABELS[role],
        text: required(p, "notes", 10000),
      });
      await write(current);
      return { case: view(c, role) };
    }
    if (action === "editCase") {
      demandInfo(role);
      const c = find(p.id);
      required(p, "reason");
      if (c.status === "deleted") fail("示範案件已移除");
      if (
        !p.changes ||
        typeof p.changes !== "object" ||
        Array.isArray(p.changes)
      )
        fail("修改內容無效");
      const updates = validate({ ...c, ...p.changes });
      if (Object.keys(p.changes).some((k) => !(k in updates)))
        fail("包含不可修改欄位");
      Object.assign(c, updates, { status: "pending", updatedAt: now() });
      await write(current);
      return { case: view(c, role) };
    }
    if (action === "changeStatus" || action === "removeCase") {
      demandInfo(role);
      const c = find(p.id);
      required(p, "reason");
      const status = action === "removeCase" ? "deleted" : p.status;
      if (!["withdrawn", "expired", "deleted"].includes(status))
        fail("案件狀態無效");
      c.previousStatus = c.status;
      c.status = status;
      c.updatedAt = now();
      await write(current);
      return { case: view(c, role) };
    }
    if (action === "getImage") {
      const i = current.images.find((i) => i.id === p.id);
      if (!i) fail("找不到示範圖片", "NOT_FOUND");
      const c = find(i.caseId);
      if (!staff(role) && !(c.status === "published" && i.approved))
        fail("尚未核准的圖片僅供審核角色查看", "FORBIDDEN");
      const preview = p.original !== true && i.thumbnailBase64;
      return {
        fileName: preview
          ? i.fileName.replace(/\.[^.]+$/, "") +
            "-preview" +
            (i.thumbnailMimeType === "image/png" ? ".png" : ".jpg")
          : i.fileName,
        mimeType: preview ? i.thumbnailMimeType : i.mimeType,
        base64: preview || i.base64,
      };
    }
    if (action === "exportCases") {
      const columns = [
        "示範案件編號",
        "標題",
        "會員",
        "聯絡方式",
        "類型",
        "縣市",
        "行政區",
        "位置",
        "分類",
        "說明",
        "需要協助",
        "摘要",
        "狀態",
      ];
      if (staff(role)) columns.push("內部備註");
      const rows = filtered(p, role).map((c) => {
        const r = [
          c.id,
          c.title,
          c.memberName,
          c.contact,
          c.propertyType,
          c.city,
          c.district,
          c.location,
          c.categories.join("、"),
          c.description,
          c.helpNeeded,
          c.summary,
          c.status,
        ];
        if (staff(role)) r.push(c.internalNotes.map((n) => n.text).join("\n"));
        return r;
      });
      const csvCell = (v) =>
        '"' +
        String(v ?? "")
          .replace(/^[\s]*[=+@-]/, "'$&")
          .replaceAll('"', '""') +
        '"';
      return {
        csv:
          "\uFEFF" +
          [columns, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n"),
        fileName: "【示範】華都更案件-" + now().slice(0, 10) + ".csv",
      };
    }
    if (action === "listAdminUsers") {
      demandInfo(role);
      return { users: current.users.map((u) => ({ ...u })) };
    }
    if (action === "saveAdminUser") {
      demandInfo(role);
      const username = required(p, "username", 80);
      if (
        !/^[A-Za-z0-9._-]{2,80}$/.test(username) ||
        !["reviewer", "info"].includes(p.role) ||
        typeof p.active !== "boolean"
      )
        fail("示範帳號或角色設定無效");
      const old = current.users.find((u) => u.username === username);
      if (
        old?.active &&
        old.role === "info" &&
        (!p.active || p.role !== "info") &&
        current.users.filter((u) => u.active && u.role === "info").length <= 1
      )
        fail("請保留至少一個示範資訊組角色");
      const user = {
        username,
        displayName: required(p, "displayName", 80),
        role: p.role,
        active: p.active,
      };
      if (old) Object.assign(old, user);
      else current.users.push(user);
      await write(current);
      return { user };
    }
    fail("不支援此示範操作", "UNKNOWN_ACTION");
  }
  let queue = Promise.resolve();
  window.HUADU_REVIEW_ADAPTER = {
    rpc(request) {
      const run = async () => {
        try {
          return { ok: true, data: await dispatch(request) };
        } catch (e) {
          return {
            ok: false,
            error: {
              code: e.code || "STORAGE_ERROR",
              message: e.code
                ? e.message
                : "瀏覽器無法儲存示範資料，可能是儲存空間不足或隱私模式限制。請更換瀏覽器或清除本示範資料後重試。",
            },
          };
        }
      };
      const result = queue.then(run, run);
      queue = result.then(() => {});
      return result;
    },
  };
})();
