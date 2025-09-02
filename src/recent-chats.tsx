import { List, ActionPanel, Action, getPreferenceValues, open, showToast, Toast } from "@raycast/api";
import { useEffect, useMemo, useState } from "react";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { exec } from "child_process";
import { promisify } from "util";
import { parsePhoneNumberFromString, CountryCode } from "libphonenumber-js";

type Prefs = { dbPath?: string; defaultCountry?: string; includeGroups?: boolean };
type Row = { jid: string; name: string | null; lastDate: number | null; preview?: string | null };

const DEFAULT_DB = "~/Library/Group Containers/group.net.whatsapp.WhatsApp.shared/ChatStorage.sqlite";

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
    defaultCountry: defaultCountry as CountryCode,
  });
  if (parsed?.isValid()) return parsed.number.replace("+", "");
  const digits = raw.replace(/\D/g, "");
  return digits || null;
}

function formatPhoneNumber(digits: string): string {
  // Add dashes for better readability
  if (digits.length === 10) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  } else if (digits.length === 11) {
    return `${digits.slice(0, 1)}-${digits.slice(1, 4)}-${digits.slice(4, 7)}-${digits.slice(7)}`;
  } else if (digits.length === 7) {
    return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  }
  return digits; // Return as-is for other lengths
}

async function readDbBytes(mainPath: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "wa-db-"));
  const base = path.basename(mainPath);
  const copyMain = path.join(dir, base);

  // Copy main DB
  await fs.copyFile(mainPath, copyMain);

  // If WAL/SHM exist, copy them too (best-effort)
  for (const ext of ["-wal", "-shm"]) {
    try {
      await fs.copyFile(mainPath + ext, copyMain + ext);
    } catch {
      // ignore if not present
    }
  }

  return copyMain;
}

export default function Command() {
  const prefs = getPreferenceValues<Prefs>();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const dbPath = useMemo(() => resolvePath(prefs.dbPath), [prefs.dbPath]);

  useEffect(() => {
    (async () => {
      try {
        const tempDbPath = await readDbBytes(dbPath);
        
        const includeGroups = !!prefs.includeGroups;
        const where = includeGroups ? "ZCONTACTJID IS NOT NULL" : "ZCONTACTJID LIKE '%@s.whatsapp.net'";

        const query = `SELECT ZCONTACTJID AS jid, ZPARTNERNAME AS name, ZLASTMESSAGEDATE AS lastDate, ZLASTMESSAGETEXT AS preview FROM ZWACHATSESSION WHERE ${where} ORDER BY ZLASTMESSAGEDATE DESC LIMIT 200;`;
        
        // Use command-line sqlite3 tool
        const execAsync = promisify(exec);
        const { stdout } = await execAsync(`sqlite3 "${tempDbPath}" -json "${query}"`);
        
        const results = JSON.parse(stdout) as {
          jid: string | number;
          name: string | null;
          lastDate: number | null;
          preview: string | null;
        }[];

        const out: Row[] = [];
        for (const r of results) {
          out.push({
            jid: String(r.jid),
            name: r.name,
            lastDate: r.lastDate,
            preview: r.preview,
          });
        }
        
        setRows(out);
      } catch (e: unknown) {
        const errorMessage = e instanceof Error ? e.message : String(e);
        showToast({
          style: Toast.Style.Failure,
          title: "Cannot read WhatsApp database",
          message: [
            errorMessage,
            "If this is a permissions issue, grant Raycast Full Disk Access in System Settings → Privacy & Security.",
          ].join(" — "),
        });
      } finally {
        setLoading(false);
      }
    })();
  }, [dbPath, prefs.includeGroups]);

  return (
    <List isLoading={loading} searchBarPlaceholder="Search recent WhatsApp chats…">
      {rows.map((r) => {
        const digits = jidToWaDigits(r.jid, prefs.defaultCountry);
        const label = r.name || digits || r.jid;

        const accessories = [];
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
                  <Action title="Open in Whatsapp" onAction={() => open(`whatsapp://send?phone=${digits}&text=`)} />
                ) : (
                  <Action.CopyToClipboard title="Copy Jid" content={r.jid} />
                )}
                <Action.OpenWith title="Reveal Db in Finder" path={dbPath} />
              </ActionPanel>
            }
          />
        );
      })}
    </List>
  );
}
