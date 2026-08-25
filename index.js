// ==UserScript==
// @name         PirateBay Screenshot Inline Grid
// @version      0.6
// @description  Finds screenshot URLs in a torrent description and loads the images in a 3-column grid.
// @match        *://thepiratebay.org/torrent/*
// @match        *://thepiratebay.org/description.php*
// @match        *://*.thepiratebay.org/torrent/*
// @match        *://*.thepiratebay.org/description.php*
// @namespace    https://greasyfork.org/users/13708
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlHttpRequest
// @connect      *
// @run-at       document-idle
// ==/UserScript==

var gmRequest = (typeof GM !== "undefined" && GM.xmlHttpRequest) ? GM.xmlHttpRequest.bind(GM) : (typeof GM_xmlhttpRequest === "function" ? GM_xmlhttpRequest : null);

function getDesc() {
    return document.getElementById("descr") || document.getElementById("description_text") || null;
}

function getTitle() {
    var name = document.getElementById("name") || document.getElementById("title");
    return name ? name.textContent.trim() : "";
}

function isPornListing() {
    var cat = document.getElementById("cat");
    return cat ? /porn/i.test(cat.textContent) : false;
}

function waitForDesc(callback) {
    var tries = 0;
    function ready() {
        var desc = getDesc();
        return desc && (desc.innerText || "").trim().length > 5;
    }
    function maybeRun() {
        if (!ready()) return false;
        if (isPornListing()) callback(getDesc());
        return true;
    }
    if (maybeRun()) return;
    var obs = new MutationObserver(function () {
        if (maybeRun()) obs.disconnect();
    });
    obs.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    (function poll() {
        if (maybeRun()) {
            obs.disconnect();
            return;
        }
        if (++tries > 50) {
            obs.disconnect();
            return;
        }
        setTimeout(poll, 200);
    })();
}

function isJunkImage(url) {
    return /logo|favicon|sprite|pixel|banner|emoji|avatar|icon|ads?\/|\/ad\/|tracking|placeholder|system\/default|peafowl/i.test(url);
}

function isDirectImageUrl(url) {
    return /\.(?:jpe?g|png|gif|webp|bmp)(?:$|\?)/i.test(url);
}

function isScreenshotUrl(url) {
    if (!url || !/^https?:\/\//i.test(url)) return false;
    if (/thepiratebay\.org|\/user\/|javascript:/i.test(url)) return false;
    if (isDirectImageUrl(url)) return true;
    // Chevereto-style and similar viewer pages, plus short hosts like ibb.co/xxxx
    return /\/(?:image|img|i|view|viewer|gallery|show|full)\/[A-Za-z0-9_-]+/i.test(url) ||
        /ibb\.co\/[A-Za-z0-9]+/i.test(url);
}

function absUrl(url, base) {
    try {
        return new URL(url, base).href;
    } catch (e) {
        return url;
    }
}

function extractDirectImageUrl(html, pageUrl) {
    var og = html.match(/property\s*=\s*["']og:image["'][^>]*content\s*=\s*["']([^"']+)/i) ||
        html.match(/content\s*=\s*["']([^"']+)["'][^>]*property\s*=\s*["']og:image["']/i);
    if (og && og[1] && !isJunkImage(og[1])) return absUrl(og[1], pageUrl);

    var twitter = html.match(/name\s*=\s*["']twitter:image["'][^>]*content\s*=\s*["']([^"']+)/i) ||
        html.match(/content\s*=\s*["']([^"']+)["'][^>]*name\s*=\s*["']twitter:image["']/i);
    if (twitter && twitter[1] && !isJunkImage(twitter[1])) return absUrl(twitter[1], pageUrl);

    var re = /(?:src|content|data-src)\s*=\s*["']([^"']+\.(?:jpe?g|png|gif|webp)[^"']*)["']/gi;
    var candidates = [];
    var m;
    while ((m = re.exec(html))) {
        var u = absUrl(m[1], pageUrl);
        if (!isJunkImage(u)) candidates.push(u);
    }
    var full = candidates.filter(function (u) {
        return /\/images\//i.test(u) && !/\.(md|th|lb)\./i.test(u);
    });
    if (full.length) return full[0];
    if (candidates.length) return candidates[0];
    return null;
}

function gmGet(url, responseType, onSuccess, onError) {
    if (!gmRequest) {
        onError(new Error("GM_xmlhttpRequest is not available. Enable it in Tampermonkey for this script."));
        return;
    }
    gmRequest({
        method: "GET",
        url: url,
        responseType: responseType || "text",
        timeout: 20000,
        onload: function (res) {
            if (res.status >= 200 && res.status < 400) onSuccess(res);
            else onError(new Error("HTTP " + res.status));
        },
        onerror: function () { onError(new Error("network error")); },
        ontimeout: function () { onError(new Error("timeout")); }
    });
}

function blobToObjectUrl(res) {
    if (res.response instanceof Blob) return URL.createObjectURL(res.response);
    if (res.response instanceof ArrayBuffer) {
        return URL.createObjectURL(new Blob([res.response]));
    }
    return null;
}

function setStatus(holder, text) {
    var status = holder.querySelector(".tpb-ss-status");
    if (status) status.textContent = text;
}

function showImage(holder, src, pageUrl) {
    var img = document.createElement("img");
    img.className = "tpb-ss-preview";
    img.src = src;
    img.alt = "screenshot";
    var link = document.createElement("a");
    link.href = pageUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.appendChild(img);
    var status = holder.querySelector(".tpb-ss-status");
    if (status) status.parentNode.replaceChild(link, status);
    else holder.appendChild(link);
}

function loadInlineImage(pageUrl, holder) {
    function afterDirectUrl(directUrl) {
        gmGet(directUrl, "blob", function (res) {
            var obj = blobToObjectUrl(res);
            showImage(holder, obj || directUrl, pageUrl);
        }, function () {
            showImage(holder, directUrl, pageUrl);
        });
    }

    if (isDirectImageUrl(pageUrl)) {
        afterDirectUrl(pageUrl);
        return;
    }

    setStatus(holder, "Loading…");
    gmGet(pageUrl, "text", function (res) {
        var html = res.responseText || "";
        var direct = extractDirectImageUrl(html, pageUrl);
        if (!direct) {
            setStatus(holder, "Could not extract image. Open the link.");
            return;
        }
        afterDirectUrl(direct);
    }, function (err) {
        setStatus(holder, "Failed to load (" + err.message + "). Open the link.");
    });
}

function makePreviewBlock(url) {
    var wrap = document.createElement("div");
    wrap.className = "tpb-ss";
    wrap.setAttribute("data-ss-url", url);
    var status = document.createElement("span");
    status.className = "tpb-ss-status";
    status.textContent = "Loading…";
    wrap.appendChild(status);
    return wrap;
}

function alreadyWrapped(node) {
    return node && node.closest && node.closest(".tpb-ss");
}

function wrapTextUrls(desc) {
    var walker = document.createTreeWalker(desc, NodeFilter.SHOW_TEXT, null, false);
    var nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    var urlRe = /https?:\/\/[^\s<>"']+/g;

    nodes.forEach(function (node) {
        if (alreadyWrapped(node.parentNode)) return;
        if (node.parentNode && node.parentNode.tagName === "A") return;
        var text = node.nodeValue;
        if (!urlRe.test(text)) return;
        urlRe.lastIndex = 0;
        var frag = document.createDocumentFragment();
        var last = 0;
        var m;
        while ((m = urlRe.exec(text))) {
            var raw = m[0];
            var url = raw.replace(/[.,);]+$/, "");
            if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
            if (isScreenshotUrl(url)) {
                frag.appendChild(makePreviewBlock(url));
                frag.appendChild(document.createTextNode(raw.slice(url.length)));
            } else {
                frag.appendChild(document.createTextNode(raw));
            }
            last = m.index + raw.length;
        }
        if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
        node.parentNode.replaceChild(frag, node);
    });
}

function wrapExistingLinks(desc) {
    var anchors = [].slice.call(desc.getElementsByTagName("a"));
    anchors.forEach(function (a) {
        if (alreadyWrapped(a) || a.classList.contains("tpb-ss-preview") || a.querySelector("img")) return;
        if (a.id === "GoogleLink" || a.id === "BingLink") return;
        var url = a.href;
        if (!isScreenshotUrl(url)) return;
        var wrap = makePreviewBlock(url);
        a.parentNode.insertBefore(wrap, a);
        a.parentNode.removeChild(a);
    });
}

function addSearchLinks(desc, torrenttitle) {
    if (document.getElementById("searchelement")) return;
    var searchnode = document.createElement("p");
    searchnode.id = "searchelement";
    searchnode.style.textAlign = "center";
    searchnode.style.fontWeight = "bold";
    desc.insertBefore(searchnode, desc.childNodes[0]);

    var q = encodeURIComponent(torrenttitle);
    var googlelink = document.createElement("a");
    googlelink.id = "GoogleLink";
    googlelink.textContent = "Search Google Images for screenshots.";
    googlelink.target = "_blank";
    googlelink.rel = "noopener noreferrer";
    googlelink.href = "https://www.google.com/search?tbm=isch&q=" + q;

    var binglink = document.createElement("a");
    binglink.id = "BingLink";
    binglink.textContent = "Search Bing Images for Screenshots.";
    binglink.target = "_blank";
    binglink.rel = "noopener noreferrer";
    binglink.href = "https://www.bing.com/images/search?q=" + q;

    searchnode.appendChild(document.createElement("hr"));
    searchnode.appendChild(document.createElement("br"));
    searchnode.appendChild(googlelink);
    searchnode.appendChild(document.createElement("br"));
    searchnode.appendChild(document.createElement("br"));
    searchnode.appendChild(binglink);
}

function collectIntoGrid(desc) {
    var blocks = [].slice.call(desc.querySelectorAll(".tpb-ss"));
    if (!blocks.length) return blocks;
    var grid = document.createElement("div");
    grid.className = "tpb-ss-grid";
    blocks[0].parentNode.insertBefore(grid, blocks[0]);
    blocks.forEach(function (block) {
        grid.appendChild(block);
    });
    return blocks;
}

function addStyles() {
    if (document.getElementById("tpb-ss-style")) return;
    var style = document.createElement("style");
    style.id = "tpb-ss-style";
    style.textContent =
        ".tpb-ss-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; width: 100%; margin: 10px 0 14px; }" +
        ".tpb-ss { min-width: 0; }" +
        ".tpb-ss > a { display: block; }" +
        ".tpb-ss-preview { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; display: block; border: 1px solid #444; background: #111; }" +
        ".tpb-ss-status { display: block; padding: 24px 6px; text-align: center; font-style: italic; opacity: 0.8; font-size: 12px; }";
    document.head.appendChild(style);
}

waitForDesc(function (desc) {
    if (!desc) return;
    addStyles();
    addSearchLinks(desc, getTitle());
    wrapTextUrls(desc);
    wrapExistingLinks(desc);
    var blocks = collectIntoGrid(desc);
    for (var i = 0; i < blocks.length; i++) {
        loadInlineImage(blocks[i].getAttribute("data-ss-url"), blocks[i]);
    }
});
