import { before } from "@api/patcher";
import { showToast } from "@api/ui/toasts";
import { findByName, findByProps } from "@metro";
import { MessageStore, UserStore } from "@metro/common/stores";
import { definePlugin } from "@plugins";
import { Contributors, Developers } from "@rain/Developers";

import { addLogEntry, clearLogs, repairCorruptedLogs } from "./database";
import Settings from "./settings";
import { useMessageLoggerSettings } from "./storage";

let patches: Array<() => void> = [];
const selfDeletedMessages = new Set<string>();
const deleteable: string[] = [];

// ✅ تخزين مؤقت لـ moment
let momentCache: any = null;
function getMoment() {
    if (!momentCache) {
        momentCache = findByProps("utc", "unix", "duration");
    }
    return momentCache;
}

// ✅ دالة مساعدة لاستخراج channelId بأمان
function getChannelId(message: any): string | undefined {
    return message?.channelId ?? message?.channel_id;
}

// ✅ دالة مساعدة لاستخراج authorId بأمان
function getAuthorId(message: any): string | undefined {
    return message?.author?.id;
}

// ✅ التحقق من قوائم التجاهل بأمان
function isInIgnoreList(list: string | undefined, id: string | undefined): boolean {
    if (!list || !id) return false;
    return list.split(/\s+/).filter(Boolean).includes(id);
}

function logToDatabase(message: any, type: "DELETE" | "UPDATE") {
    if (!message?.id) return;
    const logEntry = {
        timestamp: new Date().toISOString(),
        type,
        messageId: message.id,
        channelId: getChannelId(message),
        author: {
            id: message.author?.id,
            username: message.author?.username,
            discriminator: message.author?.discriminator,
            bot: !!message.author?.bot
        },
        content: message.content ?? "",
        attachments: message.attachments?.map((a: any) => a.url) || []
    };
    try {
        addLogEntry(logEntry);
    } catch (e) {
        console.error("[MessageLogger] Failed to log to database:", e);
    }
}

function isBot(author: any): boolean {
    if (!author) return false;
    return !!(author.bot || author.discriminator === "0000" || author.system);
}

function shouldIgnoreMessage(message: any, storage: any): boolean {
    try {
        if (!message?.author?.id) return false;
        if (storage.filters?.ignoreBots && isBot(message.author)) return true;
        if (message?.__rainenhancements) return true;
        return false;
    } catch {
        return false;
    }
}

function formatTimestamp(use12Hour: boolean): string {
    try {
        const moment = getMoment();
        if (!moment) return "";
        return moment().format(use12Hour ? "hh:mm:ss.SS a" : "HH:mm:ss.SS");
    } catch {
        return "";
    }
}

// ✅ تنظيف الرسائل المحذوفة ذاتياً بعد 10 ثوانٍ
function trackSelfDeleted(id: string) {
    selfDeletedMessages.add(id);
    setTimeout(() => selfDeletedMessages.delete(id), 10000);
}

function patchMessageDeleteHandler() {
    try {
        const FluxDispatcher = findByProps("dispatch", "_subscriptions");
        if (!FluxDispatcher) return () => {};

        return before("dispatch", FluxDispatcher, (args: any[]) => {
            try {
                const event = args[0];
                if (!event || event.type !== "MESSAGE_DELETE") return args;
                if (event.otherPluginBypass) return args;

                const storage = useMessageLoggerSettings.getState();
                if (!storage.deleted?.enabled) return args;
                if (!UserStore || !MessageStore) return args;

                const { id, channelId } = event;
                if (!id || !channelId) return args;

                const message = MessageStore.getMessage?.(channelId, id);
                if (!message) return args;

                // ✅ فحص قوائم التجاهل بأمان
                if (isInIgnoreList(storage.ignoreLists?.user, getAuthorId(message))) return args;
                if (isInIgnoreList(storage.ignoreLists?.channel, getChannelId(message))) return args;

                if (shouldIgnoreMessage(message, storage)) return args;

                // ✅ إذا كانت الرسالة محذوفة ذاتياً، تجاهلها
                if (selfDeletedMessages.has(id)) {
                    selfDeletedMessages.delete(id);
                    return args;
                }

                // ✅ إذا كانت الرسالة في قائمة الحذف المسبق، تجاهلها
                if (deleteable.includes(id)) {
                    const idx = deleteable.indexOf(id);
                    if (idx !== -1) deleteable.splice(idx, 1);
                    return args;
                }

                if (storage.databaseLogging) {
                    logToDatabase(message, "DELETE");
                }

                deleteable.push(id);

                let automodMessage = "This message was deleted";
                if (storage.custom?.customDeleteTextEnabled) {
                    automodMessage = storage.custom.customDeletedText ?? automodMessage;
                }
                if (storage.deleted?.showTimestamps) {
                    automodMessage += ` (${formatTimestamp(storage.deleted.use12Hour)})`;
                }

                args[0] = {
                    type: "MESSAGE_EDIT_FAILED_AUTOMOD",
                    messageData: {
                        type: 1,
                        message: { channelId, messageId: id },
                    },
                    errorResponseBody: { code: 200000, message: automodMessage },
                };

                setTimeout(() => {
                    try {
                        FluxDispatcher.dispatch({
                            type: "MESSAGE_UPDATE",
                            otherPluginBypass: true,
                            message: {
                                ...message,
                                flags: (message.flags || 0) | 8192,
                                content: storage.deleted?.showOnlyTimestamp ? "" : (message.content ?? "")
                            }
                        });
                    } catch (e) {
                        console.error("[MessageLogger] Failed to dispatch MESSAGE_UPDATE:", e);
                    }
                }, 0);

                return args;
            } catch (e) {
                console.error("[MessageLogger] Dispatch Patch Error:", e);
            }
            return args;
        });
    } catch (e) {
        console.error("[MessageLogger] Failed to patch delete handler:", e);
        return () => {};
    }
}

function patchMessageEditHandler() {
    try {
        const FluxDispatcher = findByProps("dispatch", "_subscriptions");
        if (!FluxDispatcher || !MessageStore) return () => {};

        const emojiRegex = /https:\/\/cdn\.discordapp\.com\/emojis\/\d+\.\w+/g;

        return before("dispatch", FluxDispatcher, (args: any[]) => {
            try {
                const event = args[0];
                if (!event || event.type !== "MESSAGE_UPDATE" || !event.message) return args;
                if (event.otherPluginBypass) return args;

                const storage = useMessageLoggerSettings.getState();
                if (!storage.edited?.enabled) return args;

                let EDIT_HISTORY_SEPARATOR = "`[ EDITED ]`";
                if (storage.custom?.customEditTextEnabled) {
                    EDIT_HISTORY_SEPARATOR = storage.custom.customEditText ?? EDIT_HISTORY_SEPARATOR;
                }

                const message = event.message;
                if (!message?.content || !message?.id) return args;

                // ✅ تجاهل تعديلات المستخدم نفسه بأمان
                if (storage.filters?.ignoreSelfEdits) {
                    const currentUserId = UserStore?.getCurrentUser?.()?.id;
                    if (currentUserId && getAuthorId(message) === currentUserId) return args;
                }

                if (isInIgnoreList(storage.ignoreLists?.user, getAuthorId(message))) return args;
                if (isInIgnoreList(storage.ignoreLists?.channel, getChannelId(message))) return args;

                const prevMessage = MessageStore.getMessage?.(
                    getChannelId(message),
                    message.id
                );
                if (!prevMessage?.content || prevMessage.content === message.content) return args;

                if (prevMessage?.__rainenhancements || message?.__rainenhancements) return args;

                const separator = storage.edited?.showSeparator !== false ? EDIT_HISTORY_SEPARATOR : "";
                const oldContent = prevMessage.content.replace(emojiRegex, "").trim();
                const newContent = oldContent + (separator ? `  ${separator}\n\n` : "\n") + message.content;

                event.message = {
                    ...message,
                    content: newContent
                };
            } catch (e) {
                console.error("[MessageLogger] MESSAGE_UPDATE Error:", e);
            }
            return args;
        });
    } catch (e) {
        console.error("[MessageLogger] Failed to patch edit handler:", e);
        return () => {};
    }
}

function patchRowManager() {
    try {
        const RowManager = findByName("RowManager");
        if (!RowManager) return () => {};

        return before("generate", RowManager.prototype, (args: any[]) => {
            try {
                const data = args[0];
                if (!data?.message) return args;

                const msg = data.message;
                const storage = useMessageLoggerSettings.getState();

                // ✅ قراءة الفاصل من الإعدادات
                let EDIT_HISTORY_SEPARATOR = "`[ EDITED ]`";
                if (storage.custom?.customEditTextEnabled) {
                    EDIT_HISTORY_SEPARATOR = storage.custom.customEditText ?? EDIT_HISTORY_SEPARATOR;
                }

                const isDeleted =
                    msg.was_deleted ||
                    msg.deleted ||
                    (typeof msg.flags === "number" && (msg.flags & 8192)) ||
                    msg.type === 6 ||
                    deleteable.includes(msg.id);

                if (isDeleted && storage.deleted?.enabled) {
                    if (shouldIgnoreMessage(msg, storage)) return args;

                    msg.style = {
                        backgroundColor: "rgba(240, 71, 71, 0.1)",
                        borderLeftWidth: 4,
                        borderLeftColor: "#F04747"
                    };
                }

                if (
                    storage.edited?.enabled &&
                    typeof msg.content === "string" &&
                    msg.content.includes(EDIT_HISTORY_SEPARATOR) &&
                    data.buttons
                ) {
                    // ✅ فحص آمن بدون regex معقد
                    const escapedSeparator = EDIT_HISTORY_SEPARATOR.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                    const separatorRegex = new RegExp(escapedSeparator, "gmi");

                    if (separatorRegex.test(msg.content)) {
                        const React = require("react");
                        const ActionSheet = findByName("ActionSheet");
                        const FormRow = findByName("FormRow");
                        const getAssetIDByName = findByProps("getAssetIDByName")?.getAssetIDByName;
                        const FluxDispatcher = findByProps("dispatch", "_subscriptions");

                        if (!React || !FormRow) return args;

                        data.buttons.push(
                            React.createElement(FormRow, {
                                label: "Remove Edit History",
                                leading: React.createElement("img", {
                                    style: { opacity: 1 },
                                    src: getAssetIDByName ? getAssetIDByName("ic_edit_24px") : undefined
                                }),
                                onPress: () => {
                                    try {
                                        const Edited = EDIT_HISTORY_SEPARATOR + "\n\n";
                                        const parts = msg.content.split(Edited);
                                        const targetMessage = parts[parts.length - 1];

                                        if (FluxDispatcher) {
                                            FluxDispatcher.dispatch({
                                                type: "MESSAGE_UPDATE",
                                                otherPluginBypass: true,
                                                message: {
                                                    ...msg,
                                                    content: targetMessage,
                                                    embeds: msg.embeds ?? [],
                                                    attachments: msg.attachments ?? [],
                                                    mentions: msg.mentions ?? [],
                                                    guild_id: msg.guild_id,
                                                },
                                            });
                                        }

                                        if (ActionSheet?.hideActionSheet) {
                                            ActionSheet.hideActionSheet();
                                        }

                                        showToast(
                                            "[MessageLogger] Edit history removed",
                                            getAssetIDByName ? getAssetIDByName("ic_edit_24px") : undefined
                                        );
                                    } catch (e) {
                                        console.error("[MessageLogger] Remove edit history error:", e);
                                    }
                                }
                            })
                        );
                    }
                }
            } catch (e) {
                console.error("[MessageLogger] RowManager Error:", e);
            }
            return args;
        });
    } catch (e) {
        console.error("[MessageLogger] Failed to patch RowManager:", e);
        return () => {};
    }
}

function patchDeleteAction() {
    try {
        const MessageActions = findByProps("deleteMessage");
        if (!MessageActions) return () => {};

        return before("deleteMessage", MessageActions, (args: any[]) => {
            try {
                const [, messageId] = args;
                if (messageId) trackSelfDeleted(messageId);
            } catch (e) {
                console.error("[MessageLogger] Delete action patch error:", e);
            }
            return args;
        });
    } catch (e) {
        console.error("[MessageLogger] Failed to patch delete action:", e);
        return () => {};
    }
}

export default definePlugin({
    name: "MessageLogger",
    description: "Prevents deleted messages from being lost by storing them in memory",
    author: [Contributors.LampDelivery, Developers.kmmiio99o],
    id: "messagelogger",
    version: "2.0.1",
    settings: Settings,
    start() {
        try {
            clearLogs();
            repairCorruptedLogs();
        } catch (e) {
            console.error("[MessageLogger] Failed to initialize database:", e);
        }
        patches.push(patchDeleteAction());
        patches.push(patchMessageDeleteHandler());
        patches.push(patchMessageEditHandler());
        patches.push(patchRowManager());
    },
    stop() {
        for (const unpatch of patches) {
            try {
                unpatch();
            } catch (e) {
                console.error("[MessageLogger] Error unpatching:", e);
            }
        }
        patches = [];
        selfDeletedMessages.clear();
        deleteable.length = 0;
        momentCache = null;
    },
});