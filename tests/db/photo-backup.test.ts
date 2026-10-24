// The Storage file backup (lib/photo-backup.ts): copies byte for byte,
// keeps a deleted file for 30 days (restorable), then drops it; the backup
// bucket is the service role's only. With a test file of our own.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { BACKUP_BUCKET, KEEP_DELETED_DAYS, backupTarget, restorePhotos, runPhotoBackup, verifyPhotoBackup } from "@/lib/photo-backup";
import { admin, signIn } from "./helpers";

const path = `_backup-test/${randomUUID()}.jpg`;
const backupPath = `visit-photos/${path}`;
const bytes = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(1024)]);
const hash = async (b: Blob | null) => (b ? createHash("sha256").update(Buffer.from(await b.arrayBuffer())).digest("hex") : null);
const target = backupTarget(admin, {});

afterAll(async () => {
  await admin.storage.from("visit-photos").remove([path]);
  await admin.storage.from(BACKUP_BUCKET).remove([backupPath]);
});

describe("the photo backup", () => {
  it("copies, keeps a deleted file to restore, and drops it after 30 days", async () => {
    await admin.storage.from("visit-photos").upload(path, bytes, { contentType: "image/jpeg" });
    const first = await runPhotoBackup(admin, target);
    expect(first.copied).toBeGreaterThanOrEqual(1);
    expect(await hash((await admin.storage.from(BACKUP_BUCKET).download(backupPath)).data)).toBe(createHash("sha256").update(bytes).digest("hex"));
    // Nothing new: nothing copied.
    expect((await runPhotoBackup(admin, target)).copied).toBe(0);
    expect((await verifyPhotoBackup(admin, target)).missing).toEqual([]);

    await admin.storage.from("visit-photos").remove([path]);
    expect((await runPhotoBackup(admin, target)).kept).toBeGreaterThanOrEqual(1);
    expect((await restorePhotos(admin, target, "visit-photos/_backup-test/")).restored).toBe(1);
    expect(await hash((await admin.storage.from("visit-photos").download(path)).data)).toBe(createHash("sha256").update(bytes).digest("hex"));

    await admin.storage.from("visit-photos").remove([path]);
    await runPhotoBackup(admin, target);
    const later = await runPhotoBackup(admin, target, new Date(Date.now() + (KEEP_DELETED_DAYS + 1) * 86_400_000));
    expect(later.removed).toBeGreaterThanOrEqual(1);
    expect((await admin.storage.from(BACKUP_BUCKET).download(backupPath)).data).toBeNull();
  });

  it("is a private bucket staff can't read, list or write", async () => {
    const owner = await signIn("owner@mapleandash.test");
    expect((await admin.storage.getBucket(BACKUP_BUCKET)).data!.public).toBe(false);
    expect((await owner.storage.from(BACKUP_BUCKET).list("")).data).toEqual([]);
    expect((await owner.storage.from(BACKUP_BUCKET).upload(`x-${randomUUID()}.txt`, "x")).error).not.toBeNull();
  });
});
