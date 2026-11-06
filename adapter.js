/* Browser-only public intake review adapter. All data stays in this app's
 * versioned IndexedDB database; no network or production source is used.
 */
(function () {
  "use strict";

  const DB_NAME = "huadu-public-intake-v2";
  const STORE_NAME = "state";
  const CATEGORIES = ["整合", "出售", "出租", "貸款活化"];
  const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
  const MAX_IMAGES = 15;
  const sessions = new Set();
  const uid = () => crypto.randomUUID();
  const now = () => new Date().toISOString();
  const clean = (value, max = 2000) =>
    typeof value === "string" ? value.trim().slice(0, max) : "";

  function fail(message, code = "INVALID_REQUEST") {
    const error = new Error(message);
    error.code = code;
    throw error;
  }

  function required(payload, key, max = 2000) {
    const value = clean(payload[key], max);
    if (!value) fail(`請填寫 ${key}`);
    return value;
  }

  let opened;
  function openDB() {
    if (!opened) {
      opened = new Promise((resolve, reject) => {
        if (!window.indexedDB) return reject(new Error("瀏覽器不支援 IndexedDB"));
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () =>
          request.result.createObjectStore(STORE_NAME);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error("示範資料庫被其他分頁阻擋"));
      });
    }
    return opened;
  }

  async function read() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const request = db
        .transaction(STORE_NAME, "readonly")
        .objectStore(STORE_NAME)
        .get("data");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function write(data) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(data, "data");
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () =>
        reject(transaction.error || new Error("示範儲存失敗"));
    });
  }

  function emptyState() {
    return { version: 2, members: [], cases: [], images: [] };
  }

  async function loadState() {
    let state = await read();
    if (!state) {
      state = emptyState();
      await write(state);
    }
    return state;
  }

  function demandMember(token) {
    if (typeof token !== "string" || !sessions.has(token))
      fail("請先開始提出需求", "UNAUTHORIZED");
  }

  function validateEmail(value) {
    const email = clean(value).toLowerCase();
    if (
      !email ||
      email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    )
      fail("請輸入有效的電子郵件地址", "INVALID_EMAIL");
    return email;
  }

  function validateSubmission(payload) {
    const submitterName = required(payload, "submitterName", 120);
    const submitterEmail = validateEmail(payload.submitterEmail);
    if (!["房屋", "土地", "其他"].includes(payload.propertyType))
      fail("請選擇有效物件類型");
    if (
      !Array.isArray(payload.categories) ||
      !payload.categories.length ||
      payload.categories.some((value) => !CATEGORIES.includes(value))
    )
      fail("請選擇有效需求分類");
    if (payload.shareConsent !== true) fail("請先勾選分享同意");
    if (payload.onBehalf === true && !clean(payload.relationship))
      fail("代填時請說明關係與授權");

    return {
      title: required(payload, "title", 120),
      submitterName,
      submitterEmail,
      // `contact` is retained as a compatibility alias for the submitter email.
      contact: submitterEmail,
      memberId: clean(payload.memberId, 100),
      propertyType: payload.propertyType,
      city: required(payload, "city", 40),
      district: required(payload, "district", 40),
      location: clean(payload.location, 200),
      categories: [...new Set(payload.categories)],
      description: required(payload, "description", 10000),
      helpNeeded: required(payload, "helpNeeded", 5000),
      onBehalf: payload.onBehalf === true,
      relationship: clean(payload.relationship, 500),
      summary: clean(payload.summary, 2000),
      shareConsent: true,
    };
  }

  function checkImage(base64, mimeType, maxBytes) {
    if (
      !["image/png", "image/jpeg"].includes(mimeType) ||
      typeof base64 !== "string" ||
      !base64.length ||
      base64.length % 4 !== 0 ||
      base64.length > Math.ceil(maxBytes / 3) * 4 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)
    )
      fail("請選擇大小符合限制的 JPEG 或 PNG 圖片", "INVALID_IMAGE");
    let raw;
    try {
      raw = atob(base64);
    } catch {
      fail("圖片編碼無效", "INVALID_IMAGE");
    }
    if (raw.length > maxBytes) fail("圖片超過大小限制", "INVALID_IMAGE");
    const byte = (index) => raw.charCodeAt(index);
    if (
      mimeType === "image/png" &&
      !(raw.length >= 33 &&
        [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => byte(index) === value) &&
        raw.slice(12, 16) === "IHDR")
    )
      fail("PNG 圖片內容無效", "INVALID_IMAGE");
    if (
      mimeType === "image/jpeg" &&
      !(raw.length >= 12 && byte(0) === 255 && byte(1) === 216 && byte(2) === 255 &&
        byte(raw.length - 2) === 255 && byte(raw.length - 1) === 217)
    )
      fail("JPEG 圖片內容無效", "INVALID_IMAGE");
    return raw.length;
  }

  function findCase(state, id) {
    return state.cases.find((item) => item.id === id) ||
      fail("找不到此筆需求", "NOT_FOUND");
  }

  function findImage(state, id) {
    return state.images.find((item) => item.id === id) ||
      fail("找不到此筆圖片", "NOT_FOUND");
  }

  function imageView(image) {
    const {
      base64,
      thumbnailBase64,
      thumbnailMimeType,
      idempotencyKey,
      ...view
    } = image;
    view.hasThumbnail = Boolean(thumbnailBase64);
    return view;
  }

  function caseView(state, item) {
    const {
      createdSessionId,
      writeReceiptToken,
      readReceiptToken,
      idempotencyKey,
      ...view
    } = structuredClone(item);
    view.images = state.images
      .filter((image) => image.caseId === item.id)
      .map(imageView);
    return view;
  }

  function receiptUrl(token) {
    const location = window.location || {};
    const origin = location.origin || "http://localhost";
    const pathname = location.pathname || "/";
    return `${origin}${pathname}#receipt=${encodeURIComponent(token)}`;
  }

  function requireWriteAccess(item, token, payload) {
    const ownsSession = item.createdSessionId === token && sessions.has(token);
    const ownsReceipt =
      typeof payload.receiptToken === "string" &&
      payload.receiptToken === item.writeReceiptToken;
    if (!ownsSession && !ownsReceipt)
      fail("此筆需求的寫入憑證無效", "FORBIDDEN");
  }

  function requireReadAccess(item, payload) {
    if (
      typeof payload.receiptToken !== "string" ||
      payload.receiptToken !== item.readReceiptToken
    )
      fail("此筆收件憑證無效", "FORBIDDEN");
  }

  function publicFinalize(item) {
    return {
      case: {
        id: item.id,
        title: item.title,
        submitterName: item.submitterName,
        submitterEmail: item.submitterEmail,
        status: item.status,
      },
      emailStatus: "demo_not_sent",
      receiptUrl: receiptUrl(item.readReceiptToken),
    };
  }

  async function dispatch(request) {
    const { action, payload = {}, token } = request || {};
    if (!payload || typeof payload !== "object" || Array.isArray(payload))
      fail("請求格式無效");

    if (action === "login" || action === "googleLogin") {
      if (action === "googleLogin" || payload.mode === "admin" || payload.mode === "review")
        fail("管理與審核登入需要正式領導團隊登入", "LEADERSHIP_LOGIN_REQUIRED");
      fail("請使用公開需求登記流程", "SUBMISSION_REQUIRED");
    }
    if (action === "startSubmission") {
      await loadState();
      const sessionToken = `submission-${uid()}`;
      sessions.add(sessionToken);
      return {
        token: sessionToken,
        role: "member",
        displayName: "需求登記人",
      };
    }

    // The public review surface deliberately has no browse, staff, or admin API.
    const publicActions = new Set([
      "bootstrap",
      "resetDemo",
      "createCase",
      "uploadImage",
      "finalizeCase",
      "getReceipt",
      "getReceiptImage",
    ]);
    if (!publicActions.has(action))
      fail("此公開頁面不提供這項操作", "FORBIDDEN");

    const state = await loadState();
    if (action === "getReceipt") {
      const item = findCase(state, payload.id);
      requireReadAccess(item, payload);
      return { case: caseView(state, item) };
    }
    if (action === "getReceiptImage") {
      const image = findImage(state, payload.id || payload.imageId);
      const item = findCase(state, image.caseId);
      requireReadAccess(item, payload);
      const original = payload.original === true || !image.thumbnailBase64;
      return {
        fileName: original
          ? image.fileName
          : `${image.fileName.replace(/\.[^.]+$/, "")}-preview.${image.thumbnailMimeType === "image/png" ? "png" : "jpg"}`,
        mimeType: original ? image.mimeType : image.thumbnailMimeType,
        base64: original ? image.base64 : image.thumbnailBase64,
      };
    }

    demandMember(token);
    if (action === "bootstrap")
      return {
        environment: "public-intake-v2",
        members: [],
        user: { role: "member", displayName: "需求登記人" },
      };
    if (action === "resetDemo") {
      await write(emptyState());
      return { reset: true };
    }
    if (action === "createCase") {
      const key = clean(payload.idempotencyKey, 200);
      const existing = key && state.cases.find(
        (item) => item.createdSessionId === token && item.idempotencyKey === key,
      );
      if (existing)
        return { case: caseView(state, existing), receiptToken: existing.writeReceiptToken };

      const item = {
        id: uid(),
        ...validateSubmission(payload),
        status: "draft",
        createdAt: now(),
        updatedAt: now(),
        createdSessionId: token,
        writeReceiptToken: uid(),
        readReceiptToken: "",
        idempotencyKey: key,
      };
      state.cases.push(item);
      await write(state);
      return { case: caseView(state, item), receiptToken: item.writeReceiptToken };
    }
    if (action === "uploadImage") {
      const item = findCase(state, payload.caseId);
      requireWriteAccess(item, token, payload);
      if (item.status !== "draft") fail("需求已送出，不能再新增圖片", "FORBIDDEN");
      const key = required(payload, "idempotencyKey", 200);
      const existing = state.images.find(
        (image) => image.caseId === item.id && image.idempotencyKey === key,
      );
      if (existing) return { image: imageView(existing) };
      const count = state.images.filter((image) => image.caseId === item.id).length;
      if (count >= MAX_IMAGES) fail(`每筆需求最多 ${MAX_IMAGES} 張圖片`, "INVALID_IMAGE");

      const fileName = required(payload, "fileName", 160);
      if (/[\x00-\x1f\x7f<>:"/\\|?*]/.test(fileName) || [".", ".."].includes(fileName))
        fail("圖片檔名含不安全字元", "INVALID_IMAGE");
      const size = checkImage(payload.base64, payload.mimeType, MAX_IMAGE_BYTES);
      let thumbnailSize;
      if (payload.thumbnailBase64 !== undefined) {
        thumbnailSize = checkImage(payload.thumbnailBase64, payload.thumbnailMimeType, 2 * 1024 * 1024);
        if (thumbnailSize > size) fail("縮圖不可大於原始圖片", "INVALID_IMAGE");
      }
      const image = {
        id: uid(),
        caseId: item.id,
        fileName,
        mimeType: payload.mimeType,
        base64: payload.base64,
        size,
        createdAt: now(),
        idempotencyKey: key,
        ...(payload.thumbnailBase64 !== undefined
          ? {
              thumbnailBase64: payload.thumbnailBase64,
              thumbnailMimeType: payload.thumbnailMimeType,
            }
          : {}),
      };
      state.images.push(image);
      item.updatedAt = now();
      await write(state);
      return { image: imageView(image) };
    }
    if (action === "finalizeCase") {
      const item = findCase(state, payload.id);
      requireWriteAccess(item, token, payload);
      if (item.status === "pending" && item.readReceiptToken)
        return publicFinalize(item);
      if (item.status !== "draft") fail("需求目前無法送出");
      item.status = "pending";
      item.updatedAt = now();
      item.readReceiptToken = uid();
      await write(state);
      return publicFinalize(item);
    }
    fail("此公開頁面不提供這項操作", "FORBIDDEN");
  }

  let queue = Promise.resolve();
  window.HUADU_REVIEW_ADAPTER = {
    rpc(request) {
      const run = async () => {
        try {
          return { ok: true, data: await dispatch(request) };
        } catch (error) {
          return {
            ok: false,
            error: {
              code: error.code || "STORAGE_ERROR",
              message: error.code
                ? error.message
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

  // Receipt links may be opened while the intake app is already mounted. Reload
  // once when a well-formed receipt hash is selected so boot can read it.
  window.addEventListener?.("hashchange", () => {
    const hash = String(window.location?.hash || "");
    if (/#receipt=[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(hash))
      window.location.reload?.();
  });
})();
