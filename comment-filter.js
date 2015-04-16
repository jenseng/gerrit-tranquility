// ==UserScript==
// @name         Gerrit bot comment toggler
// @namespace    http://nobots.instructure/
// @version      0.2
// @description  Because why not
// @author       Jon
// @match        https://gerrit.instructure.com/
// @grant        none
// ==/UserScript==

var hasHideableComments = false;
var botCommentsEnabled = localStorage.getItem("botCommentsEnabled") !== "false";

var transforms = {
    get: {
        open: function(__super) {
            return function() {
                var args = [].slice.call(arguments);
                if (args[1] && args[1].match(/\/changes\/\d+\/revisions\/\w+\/comments/)) {
                    this._isCommentRequest = true;
                } else if (args[1] && args[1].match(/\/gerrit_ui\/rpc\/PatchDetailService$/)) {
                    this._isPatchDetailRequest = true
                }
                    
                var ret = __super(args);
                return ret;
            }
        },
        
        responseText: function(value) {
            return this.__responseText || value;
        }
    },
    
    set: {
        onreadystatechange: function(__super) {
            return function() {
                var args = [].slice.call(arguments);
                if (this.frdXhr.readyState === 4) {
                    if (this._isCommentRequest) {
                        var response = this.frdXhr.responseText;
                        var prefix = ")]}'\n";
                        response = JSON.parse(response.slice(prefix.length));
                        var newObj = filterAllComments(response);
                        updateBotToggle()
                        this.__responseText = prefix + JSON.stringify(newObj);
                    } else if (this._isPatchDetailRequest) {
                        var response = JSON.parse(this.frdXhr.responseText);
                        var newObj = filterPatchDetail(response);
                        updateBotToggle();
                        this.__responseText = JSON.stringify(newObj);
                    }
                }
                __super(args);
            }
        }
    }
}

function filterAllComments(obj) {
    var newObj = {};
    for (var key in obj) {
        var comments = filterFileComments(obj[key]);
        if (comments.length)
            newObj[key] = comments;
    }
    return newObj;
}

function isBotName(name)
{
    return name.match(/\(Bot\)/);
}

function keepComment(is_bot, comment_text)
{
    var keep = !is_bot || comment_text.match(/^\[(WARN|ERROR)\]/); // let serious stuff through though
    hasHideableComments = hasHideableComments || !keep;
    return botCommentsEnabled || keep;
}

function filterFileComments(comments) {
    return comments.filter(function(comment) {
        var is_bot = comment.author && isBotName(comment.author.name);
        return keepComment(is_bot, comment.message);
    });
}

function findBotAccounts(patch_detail) {
    return patch_detail.result.comments.accounts.accounts.reduce(function(ids, account) {
        if (account.fullName && isBotName(account.fullName)) {
            ids = ids.concat(account.id.id)
        }
        return ids;
    }, [])
}

function filterPatchDetail(patch_detail) {
    var bot_account_ids = findBotAccounts(patch_detail);
    patch_detail.result.comments.b = patch_detail.result.comments.b.filter(function(comment) {
        var is_bot = comment.author && bot_account_ids.indexOf(comment.author.id) >= 0;
        return keepComment(is_bot, comment.message);
    });
    return patch_detail;
}

function transformGet(frd, key) {
    var value = frd[key];
    if (transforms.get[key]) {
        if (typeof value === "function")
            value = value.apply.bind(value, frd);
        value = transforms.get[key].call(this, value);
        if (typeof value === "function")
            value = value.bind(this);
    } else if (typeof value === "function") {
        value = value.bind(frd);
    }
    return value;
}

function transformSet(frd, key, value) {
    if (transforms.set[key]) {
        if (typeof value === "function")
            value = value.apply.bind(value, frd);
        value = transforms.set[key].call(this, value);
        if (typeof value === "function")
            value = value.bind(this);
    }
    return value;
}

function proxyProp(obj, frd, key) {
    var properties = {
        get: function() {
            return transformGet.call(this, this.frdXhr, key);
        },
        enumerable: true
    };
    if (["readyState", "response", "responseText", "responseXML", "status", "statusText", "upload"].indexOf(key) == -1) {
        properties.set = function(newValue) {
            frd[key] = transformSet.call(this, this.frdXhr, key, newValue);
        };   
    }
    Object.defineProperty(obj, key, properties);
}

var OrigXMLHttpRequest = XMLHttpRequest;
window.XMLHttpRequest = function(options) {
    var frdXhr = new OrigXMLHttpRequest(options);
    this.frdXhr = frdXhr;
    for (var key in frdXhr) {
        if (frdXhr.hasOwnProperty(key)) {
            proxyProp(this, frdXhr, key);
        }
    }
};

var newProto = window.XMLHttpRequest.prototype = {};
var oldProto = OrigXMLHttpRequest.prototype
for (var key in oldProto) {
    proxyProp(newProto, oldProto, key);
}

var botToggle = document.createElement("DIV");

function toggleBotComments() {
    localStorage.setItem("botCommentsEnabled", (!botCommentsEnabled).toString());
    location.reload();
}

function updateBotToggle() {
    if (hasHideableComments) {
        botToggle.innerHTML =
            '<div style="background: #ffc; cursor: pointer; border-style: solid; border-color: #cc8; border-width: 1px 1px 0 0; padding: 5px 10px; font-weight: bold;">' + 
                '<img src="//en.gravatar.com/userimage/21117697/619762dee47a8b1eed21c1ce9a5481d5.jpeg" width="20" height="20" style="vertical-align: middle"> ' +
                (botCommentsEnabled ? "Hide Bot Comments" : "Show Bot Comments") +
            '</div>'
    }
}

botToggle.style.position = "fixed";
botToggle.style.zIndex = "1000";
botToggle.style.bottom = "0";
botToggle.style.right = "0";
botToggle.addEventListener('click', toggleBotComments);
document.body.appendChild(botToggle);
