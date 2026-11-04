import type { PrismaClient } from "@prisma/client";
import { alertSignature, parseAlertTypes, ruleMatches, type AlertSnapshot } from "./alert-rules";

type Db = PrismaClient;

export async function recordAlerts(db: Db, anomalies: AlertSnapshot[], now = new Date()) {
  const seen = new Set<string>();
  const opened: { type: string; severity: string; message: string; signature: string }[] = [];

  for (const anomaly of anomalies) {
    const signature = alertSignature(anomaly);
    seen.add(signature);
    const detailJson = JSON.stringify(anomaly.details ?? []).slice(0, 4000);
    const existing = await db.alertEvent.findUnique({ where: { signature } });
    if (!existing) {
      await db.alertEvent.create({
        data: {
          type: anomaly.type,
          severity: anomaly.severity,
          signature,
          message: anomaly.message,
          status: "open",
          hitCount: 1,
          detailJson,
          firstSeenAt: now,
          lastSeenAt: now,
        },
      });
      opened.push({ type: anomaly.type, severity: anomaly.severity, message: anomaly.message, signature });
      continue;
    }
    const reopened = existing.status === "resolved";
    await db.alertEvent.update({
      where: { id: existing.id },
      data: {
        type: anomaly.type,
        severity: anomaly.severity,
        message: anomaly.message,
        detailJson,
        status: "open",
        hitCount: existing.hitCount + 1,
        lastSeenAt: now,
        ...(reopened ? { resolvedAt: null } : {}),
      },
    });
    if (reopened) {
      opened.push({ type: anomaly.type, severity: anomaly.severity, message: anomaly.message, signature });
    }
  }

  if (seen.size === 0) {
    await db.alertEvent.updateMany({
      where: { status: "open" },
      data: { status: "resolved", resolvedAt: now },
    });
  } else {
    await db.alertEvent.updateMany({
      where: { status: "open", signature: { notIn: [...seen] } },
      data: { status: "resolved", resolvedAt: now },
    });
  }

  if (opened.length > 0) await dispatchOpenedAlerts(db, opened);
  return { opened: opened.length };
}

async function dispatchOpenedAlerts(
  db: Db,
  alerts: { type: string; severity: string; message: string; signature: string }[],
) {
  const rules = await db.alertRule.findMany({ where: { enabled: true } });
  for (const rule of rules) {
    const matched = alerts.filter((alert) =>
      ruleMatches({ minSeverity: rule.minSeverity, types: parseAlertTypes(rule.typesJson) }, alert),
    );
    if (matched.length === 0) continue;
    const target = rule.target.trim();
    if (!target) {
      await db.alertRule.update({
        where: { id: rule.id },
        data: { lastError: "推送地址为空", lastSentAt: new Date() },
      });
      continue;
    }
    try {
      const response = await fetch(target, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: "linkai-insight", alerts: matched }),
        signal: AbortSignal.timeout(4000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await db.alertRule.update({
        where: { id: rule.id },
        data: { lastError: "", lastSentAt: new Date() },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await db.alertRule.update({
        where: { id: rule.id },
        data: { lastError: message.slice(0, 200), lastSentAt: new Date() },
      });
    }
  }
}
