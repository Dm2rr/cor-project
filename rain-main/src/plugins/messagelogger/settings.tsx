import { findAssetId } from "@api/assets";
import SettingsTextInput from "@api/ui/components/SettingsTextInput";
import { findByProps } from "@metro";
import { Stack, TableRow, TableRowGroup, TableSwitchRow } from "@metro/common/components";
import React from "react";
import { ScrollView } from "react-native";

import { useMessageLoggerSettings } from "./storage";

// ✅ حماية من undefined
const Card = findByProps("Card")?.Card ?? ({ children }: any) => <>{children}</>;

// ✅ دالة مساعدة لتحديث الإعدادات بأمان
function updateSettings(partial: any) {
    useMessageLoggerSettings.getState().updateSettings(partial);
}

// ✅ أيقونة آمنة
function safeIcon(name: string) {
    try {
        const id = findAssetId(name);
        return id ? <TableRow.Icon source={id} /> : undefined;
    } catch {
        return undefined;
    }
}

// ✅ تنظيف قوائم الـ IDs
function sanitizeIds(value: string): string {
    return value.replace(/[^0-9 ]/g, "");
}

export default function MessageLoggerSettings() {
    const settings = useMessageLoggerSettings();

    // ✅ قيم افتراضية آمنة
    const deleted = settings?.deleted ?? {};
    const edited = settings?.edited ?? {};
    const filters = settings?.filters ?? {};
    const ignoreLists = settings?.ignoreLists ?? { user: "", channel: "" };
    const custom = settings?.custom ?? {};

    return (
        <ScrollView style={{ flex: 1 }}>
            <Stack style={{ paddingVertical: 24, paddingHorizontal: 12 }} spacing={24}>

                {/* ===== Deleted Messages ===== */}
                <TableRowGroup title="Deleted Messages">
                    <TableSwitchRow
                        label="Enable"
                        icon={safeIcon("ic_eye_hidden")}
                        value={!!deleted.enabled}
                        onValueChange={v => updateSettings({ deleted: { ...deleted, enabled: v } })}
                    />
                    <TableSwitchRow
                        label="Show Timestamps"
                        icon={safeIcon("ic_clock")}
                        value={!!deleted.showTimestamps}
                        onValueChange={v => updateSettings({ deleted: { ...deleted, showTimestamps: v } })}
                    />
                    <TableSwitchRow
                        label="Use 12-Hour Format"
                        icon={safeIcon("ic_clock")}
                        value={!!deleted.use12Hour}
                        onValueChange={v => updateSettings({ deleted: { ...deleted, use12Hour: v } })}
                    />
                    <TableSwitchRow
                        label="Show Only Timestamp"
                        icon={safeIcon("ic_clock")}
                        value={!!deleted.showOnlyTimestamp}
                        onValueChange={v => updateSettings({ deleted: { ...deleted, showOnlyTimestamp: v } })}
                    />
                </TableRowGroup>

                {/* ===== Edited Messages ===== */}
                <TableRowGroup title="Edited Messages">
                    <TableSwitchRow
                        label="Enable"
                        icon={safeIcon("ic_eye_hidden")}
                        value={!!edited.enabled}
                        onValueChange={v => updateSettings({ edited: { ...edited, enabled: v } })}
                    />
                    <TableSwitchRow
                        label="Show Separator"
                        icon={safeIcon("MoreVerticalIcon")}
                        value={!!edited.showSeparator}
                        onValueChange={v => updateSettings({ edited: { ...edited, showSeparator: v } })}
                    />
                </TableRowGroup>

                {/* ===== Filters ===== */}
                <TableRowGroup title="Filters">
                    <TableSwitchRow
                        label="Ignore Bots"
                        icon={safeIcon("ic_close")}
                        value={!!filters.ignoreBots}
                        onValueChange={v => updateSettings({ filters: { ...filters, ignoreBots: v } })}
                    />
                    <TableSwitchRow
                        label="Ignore Self Edits"
                        icon={safeIcon("ic_close")}
                        value={!!filters.ignoreSelfEdits}
                        onValueChange={v => updateSettings({ filters: { ...filters, ignoreSelfEdits: v } })}
                    />
                </TableRowGroup>

                {/* ===== User Ignore List ===== */}
                <TableRowGroup title="User ignore list">
                    <Card>
                        <SettingsTextInput
                            placeholder="Enter a list of IDs to ignore separated by spaces."
                            value={ignoreLists.user ?? ""}
                            onChange={(v: string) =>
                                updateSettings({
                                    ignoreLists: { ...ignoreLists, user: sanitizeIds(v) }
                                })
                            }
                            isClearable
                        />
                    </Card>
                </TableRowGroup>

                {/* ===== Channel Ignore List ===== */}
                <TableRowGroup title="Channel ignore list">
                    <Card>
                        <SettingsTextInput
                            placeholder="Enter a list of Channel IDs to ignore separated by spaces."
                            value={ignoreLists.channel ?? ""}
                            onChange={(v: string) =>
                                updateSettings({
                                    ignoreLists: { ...ignoreLists, channel: sanitizeIds(v) }
                                })
                            }
                            isClearable
                        />
                    </Card>
                </TableRowGroup>

                {/* ===== Database ===== */}
                <TableRowGroup title="Database">
                    <TableSwitchRow
                        label="Enable Logging"
                        icon={safeIcon("ic_download_24px")}
                        value={!!settings?.databaseLogging}
                        onValueChange={v => updateSettings({ databaseLogging: v })}
                    />
                </TableRowGroup>

                {/* ===== Custom Modification Texts ===== */}
                <TableRowGroup title="Custom Modification Texts">
                    <TableSwitchRow
                        label="Enable Custom Edit Messages"
                        icon={safeIcon("ic_overflow_android")}
                        subLabel="The edit message will separate the modified message and the original message."
                        value={!!custom.customEditTextEnabled}
                        onValueChange={v =>
                            updateSettings({ custom: { ...custom, customEditTextEnabled: v } })
                        }
                    />
                    <TableSwitchRow
                        label="Enable Custom Delete Messages"
                        icon={safeIcon("ic_overflow_android")}
                        subLabel="The delete message will appear as a automod message under the deleted message."
                        value={!!custom.customDeleteTextEnabled}
                        onValueChange={v =>
                            updateSettings({ custom: { ...custom, customDeleteTextEnabled: v } })
                        }
                    />
                </TableRowGroup>

                {/* ===== Custom Edit Text ===== */}
                {custom.customEditTextEnabled === true && (
                    <TableRowGroup title="Custom Edit Text">
                        <Card>
                            <SettingsTextInput
                                placeholder="Custom Edit Text Goes here"
                                value={custom.customEditText ?? ""}
                                onChange={(v: string) =>
                                    updateSettings({ custom: { ...custom, customEditText: v } })
                                }
                                isClearable
                            />
                        </Card>
                    </TableRowGroup>
                )}

                {/* ===== Custom Delete Text ===== */}
                {custom.customDeleteTextEnabled === true && (
                    <TableRowGroup title="Custom Delete Text">
                        <Card>
                            <SettingsTextInput
                                placeholder="Custom Delete Text Goes here"
                                value={custom.customDeletedText ?? ""}
                                onChange={(v: string) =>
                                    updateSettings({ custom: { ...custom, customDeletedText: v } })
                                }
                                isClearable
                            />
                        </Card>
                    </TableRowGroup>
                )}

            </Stack>
        </ScrollView>
    );
}