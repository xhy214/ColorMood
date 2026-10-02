// window.xhs.miniTool.* 封装（容器外优雅降级）
window.ColorMood = window.ColorMood || {};
window.ColorMood.bridge = (function () {
  function api(name) {
    return (window.xhs && window.xhs.miniTool && window.xhs.miniTool[name]) || null;
  }

  function available() {
    return !!(window.xhs && window.xhs.miniTool);
  }

  // data:uri 完整性校验
  function assertDataUri(data) {
    if (typeof data !== "string" || data.indexOf("data:") !== 0 || data.indexOf(";base64,") < 0) {
      throw new Error("writeTempFile 需要完整 data:uri");
    }
  }

  function writeTempFile(dataUri) {
    assertDataUri(dataUri);
    const fn = api("writeTempFile");
    if (!fn) return Promise.reject(new Error("bridge unavailable"));
    return fn({ data: dataUri });
  }

  function saveImage(dataUri) {
    const fn = api("saveImageToPhotosAlbum");
    if (!fn) return Promise.reject(new Error("bridge unavailable"));
    return writeTempFile(dataUri).then(function (res) {
      return fn({ filePath: res.filePath });
    });
  }

  function postNote(opts) {
    const fn = api("postNote");
    if (!fn) return Promise.reject(new Error("bridge unavailable"));
    return fn({
      title: (opts.title || "").slice(0, 20),
      content: (opts.content || "").slice(0, 1000),
      pageType: "photo_publish",
      mediaInfo: { image_resources: [{ url: opts.imageDataUri }] }
    });
  }

  function openSearch(keyword) {
    const fn = api("openRedPage");
    if (!fn) return Promise.reject(new Error("bridge unavailable"));
    return fn({ type: "search", params: { keyword: keyword } });
  }

  return {
    available: available,
    writeTempFile: writeTempFile,
    saveImage: saveImage,
    postNote: postNote,
    openSearch: openSearch
  };
})();
