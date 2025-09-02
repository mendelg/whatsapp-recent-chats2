import { List, ActionPanel, Action, getPreferenceValues, open, showToast, Toast } from "@raycast/api";
import { useEffect, useMemo, useState } from "react";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { execFile } from "child_process";
import { promisify } from "util";
import { parsePhoneNumberFromString, CountryCode } from "libphonenumber-js";

type Prefs = { dbPath?: string; defaultCountry?: string; includeGroups?: boolean };
type Row = { jid: string; name: string | null; lastDate: number | null; preview?: string | null };

const DEFAULT_DB = "~/Library/Group Containers/group.net.whatsapp.WhatsApp.shared/ChatStorage.sqlite";
const SQLITE_BIN = "/usr/bin/sqlite3"; // macOS default

const execFileAsync = promisify(execFile);

function resolvePath(p?: string): string {
  const raw = (p && p.trim()) || DEFAULT_DB;
  if (raw.startsWith("~")) return path.join(os.homedir(), raw.slice(1));
  return raw;
}

function cocoaToDate(sec?: number | null): Date | undefined {
  if (sec == null || Number.isNaN(sec)) return;
  return new Date((sec + 978_307_200) * 1000);
}

function jidToWaDigits(jid: string, defaultCountry?: string): string | null {
  if (!jid.endsWith("@s.whatsapp.net")) return null; // 1:1 only
  const raw = jid.replace("@s.whatsapp.net", "");
  const parsed = parsePhoneNumberFromString(raw.startsWith("+") ? raw : raw, {
    defaultCountry: defaultCountry as CountryCode | undefined,
  });
  if (parsed?.isValid()) return parsed.number.replace("+", "");
  const digits = raw.replace(/\D/g, "");
  return digits || null;
}

function formatPhoneNumber(digits: string): string {
  if (digits.length === 10) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  if (digits.length === 11) return `${digits.slice(0, 1)}-${digits.slice(1, 4)}-${digits.slice(4, 7)}-${digits.slice(7)}`;
  if (digits.length === 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return digits;
}

async function makeReadableCopy(mainPath: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "wa-db-"));
  const base = path.basename(mainPath);
  const copyMain = path.join(dir, base);
  await fs.copyFile(mainPath, copyMain);
  for (const ext of ["-wal", "-shm"]) {
    try {
      await fs.copyFile(mainPath + ext, copyMain + ext);
    } catch {
      /* ignore */
    }
  }
  return copyMain;
}

async function cleanupTemp(copyMain: string) {
  try {
    await fs.unlink(copyMain).catch(() => {});
    await fs.unlink(copyMain + "-wal").catch(() => {});
    await fs.unlink(copyMain + "-shm").catch(() => {});
    await fs.rmdir(path.dirname(copyMain)).catch(() => {});
  } catch {
    // ignore errors
  }
}

// Try to run with -json; if not supported, fall back to CSV and parse it.
async function runSqliteQuery(dbPath: string, query: string): Promise<any[]> {
  try {
    const { stdout } = await execFileAsync(SQLITE_BIN, [dbPath, "-json", query], { maxBuffer: 10 * 1024 * 1024 });
    if (!stdout.trim()) return [];
    return JSON.parse(stdout);
  } catch {
    const { stdout } = await execFileAsync(
      SQLITE_BIN,
      ["-header", "-csv", dbPath, query],
      { maxBuffer: 10 * 1024 * 1024 }
    );
    if (!stdout.trim()) return [];
    const lines = stdout.split(/\r?\n/).filter(Boolean);
    const header = lines.shift()!.split(",");
    return lines.map((line) => {
      const cols = line.split(",");
      const obj: Record<string, string> = {};
      header.forEach((h, i) => (obj[h] = cols[i] ?? ""));
      return {
        jid: obj["jid"],
        name: obj["name"] || null,
        lastDate: obj["lastDate"] ? Number(obj["lastDate"]) : null,
        preview: obj["preview"] || null,
      };
    });
  }
}

export default function Command() {
  const prefs = getPreferenceValues<Prefs>();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const dbPath = useMemo(() => resolvePath(prefs.dbPath), [prefs.dbPath]);

  useEffect(() => {
    (async () => {
      let tempDbPath: string | null = null;
      try {
        tempDbPath = await makeReadableCopy(dbPath);
        const includeGroups = !!prefs.includeGroups;
        const where = includeGroups ? "ZCONTACTJID IS NOT NULL" : "ZCONTACTJID LIKE '%@s.whatsapp.net'";
        const query = `
          SELECT
            ZCONTACTJID AS jid,
            ZPARTNERNAME AS name,
            ZLASTMESSAGEDATE AS lastDate,
            ZLASTMESSAGETEXT AS preview
          FROM ZWACHATSESSION
          WHERE ${where}
          ORDER BY ZLASTMESSAGEDATE DESC
          LIMIT 200;
        `.trim();

        const results = (await runSqliteQuery(tempDbPath, query)) as {
          jid: string | number;
          name: string | null;
          lastDate: number | null;
          preview: string | null;
        }[];

        setRows(results.map((r) => ({
          jid: String(r.jid),
          name: r.name,
          lastDate: r.lastDate,
          preview: r.preview,
        })));
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        showToast({
          style: Toast.Style.Failure,
          title: "Cannot read WhatsApp database",
          message: `${msg} — If this is a permissions issue, grant Raycast Full Disk Access in System Settings → Privacy & Security.`,
        });
      } finally {
        if (tempDbPath) await cleanupTemp(tempDbPath);
        setLoading(false);
      }
    })();
  }, [dbPath, prefs.includeGroups]);

  return (
    <List isLoading={loading} searchBarPlaceholder="Search recent WhatsApp chats…">
      {rows.map((r) => {
        const digits = jidToWaDigits(r.jid, prefs.defaultCountry);
        const label = r.name || digits || r.jid;

        const accessories: List.Item.Accessory[] = [];
        const when = cocoaToDate(r.lastDate);
        if (when) accessories.push({ date: when, tooltip: `Last: ${when.toLocaleString()}` });

        return (
          <List.Item
            key={r.jid}
            title={label}
            subtitle={digits ? `+${formatPhoneNumber(digits)}` : r.jid}
            accessories={accessories}
            actions={
              <ActionPanel>
                {digits ? (
                  <Action title="Open in WhatsApp" onAction={() => open(`whatsapp://send?phone=${digits}&text=`)} />
                ) : (
                  <Action.CopyToClipboard title="Copy JID" content={r.jid} />
                )}
                <Action.OpenWith title="Reveal DB in Finder" path={dbPath} />
              </ActionPanel>
            }
          />
        );
      })}
    </List>
  );
}
