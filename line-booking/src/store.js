// 簡易 JSON 檔案儲存：適合小型店家。量大時可換成資料庫，只要維持相同介面即可。
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export class BookingStore {
  constructor(file) {
    this.file = file;
    this.bookings = null;
    this.writing = Promise.resolve();
  }

  async load() {
    if (this.bookings) return;
    try {
      this.bookings = JSON.parse(await readFile(this.file, 'utf8'));
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      this.bookings = [];
    }
  }

  async save() {
    const snapshot = JSON.stringify(this.bookings, null, 2);
    // 串接寫入，避免同時寫檔互相覆蓋；先寫暫存檔再改名，確保檔案不會寫一半。
    this.writing = this.writing.then(async () => {
      await mkdir(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      await writeFile(tmp, snapshot);
      await rename(tmp, this.file);
    });
    return this.writing;
  }

  async create(data) {
    await this.load();
    const booking = {
      id: randomUUID().slice(0, 8),
      status: 'confirmed',
      remindersSent: [],
      createdAt: new Date().toISOString(),
      ...data,
    };
    this.bookings.push(booking);
    await this.save();
    return booking;
  }

  async update(id, patch) {
    await this.load();
    const booking = this.bookings.find((b) => b.id === id);
    if (!booking) return null;
    Object.assign(booking, patch);
    await this.save();
    return booking;
  }

  async get(id) {
    await this.load();
    return this.bookings.find((b) => b.id === id) ?? null;
  }

  async countForSlot(date, time) {
    await this.load();
    return this.bookings.filter((b) => b.status === 'confirmed' && b.date === date && b.time === time).length;
  }

  async upcomingForUser(lineUserId, now = new Date()) {
    await this.load();
    return this.bookings
      .filter((b) => b.lineUserId === lineUserId && b.status === 'confirmed' && new Date(b.start) > now)
      .sort((a, b) => a.start.localeCompare(b.start));
  }

  async confirmedUpcoming(now = new Date()) {
    await this.load();
    return this.bookings.filter((b) => b.status === 'confirmed' && new Date(b.start) > now);
  }
}
