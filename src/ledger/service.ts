import { ApiError, notFound } from "../lib/errors.ts";
import { toMinor } from "../lib/money.ts";
import type { RatesService } from "../rates/service.ts";
import type {
  Account,
  Category,
  StoredAccount,
  Transaction,
  TransactionInput,
} from "../schemas/ledger.ts";
import { DEFAULT_PROFILE } from "../schemas/profile.ts";
import type { NewTransaction, Store } from "../store/types.ts";
import { DEFAULT_CATEGORIES, V1_CATEGORY_KEYS } from "./seed.ts";

export const withBalance = (account: StoredAccount): Account => ({
  ...account,
  balanceMinor: account.openingBalanceMinor + account.flowMinor,
});

const byOrder = <T extends { order: number; createdAt: string }>(a: T, b: T) =>
  a.order - b.order || a.createdAt.localeCompare(b.createdAt);

/** The rules the routes share: seeding, checks across documents and the frozen PLN value. */
export class Ledger {
  private readonly store: Store;
  private readonly rates: RatesService;
  private readonly now: () => Date;

  constructor(store: Store, rates: RatesService, now: () => Date = () => new Date()) {
    this.store = store;
    this.rates = rates;
    this.now = now;
  }

  stamp() {
    return this.now().toISOString();
  }

  /** The currency of a new budget or goal when the request names none. */
  async baseCurrency(uid: string) {
    return (await this.store.profiles.get(uid))?.baseCurrency ?? DEFAULT_PROFILE.baseCurrency;
  }

  private async locale(uid: string) {
    return (await this.store.profiles.get(uid))?.locale ?? DEFAULT_PROFILE.locale;
  }

  async accounts(uid: string) {
    return (await this.store.accounts.list(uid)).sort(byOrder).map(withBalance);
  }

  async account(uid: string, id: string) {
    const account = await this.store.accounts.get(uid, id);
    if (!account) throw notFound("account", id);
    return account;
  }

  /** The user's categories; a new user gets the default set in their language first. */
  async categories(uid: string): Promise<Category[]> {
    const existing = await this.store.categories.list(uid);
    if (existing.length) return existing.sort(byOrder);
    const locale = await this.locale(uid);
    const at = this.stamp();
    const created = [];
    for (const [order, seed] of DEFAULT_CATEGORIES.entries()) {
      created.push(
        await this.store.categories.create(uid, {
          key: seed.key,
          name: seed[locale],
          kind: seed.kind,
          icon: seed.icon,
          colour: seed.colour,
          archived: false,
          order,
          createdAt: at,
          updatedAt: at,
        }),
      );
    }
    return created;
  }

  /** Checks an input against the user's accounts and categories and freezes its value in PLN. */
  async prepare(
    uid: string,
    input: TransactionInput,
    keep?: Pick<Transaction, "origin" | "createdAt">,
  ): Promise<NewTransaction> {
    const account = await this.account(uid, input.accountId);
    let toAmountMinor: number | null = null;

    if (input.kind === "transfer") {
      if (!input.toAccountId) throw new ApiError("validation", "A transfer needs `toAccountId`");
      if (input.toAccountId === input.accountId) {
        throw new ApiError("validation", "A transfer needs two different accounts");
      }
      if (input.categoryId) throw new ApiError("validation", "A transfer has no category");
      const to = await this.account(uid, input.toAccountId);
      toAmountMinor =
        input.toAmountMinor ??
        (to.currency === account.currency
          ? input.amountMinor
          : (await this.rates.convert(input.amountMinor, account.currency, to.currency, input.date))
              .resultMinor);
    } else {
      if (input.toAccountId || input.toAmountMinor) {
        throw new ApiError("validation", "Only a transfer has `toAccountId` and `toAmountMinor`");
      }
      if (input.categoryId) {
        const category = await this.store.categories.get(uid, input.categoryId);
        if (!category) throw notFound("category", input.categoryId);
        if (category.kind !== input.kind) {
          throw new ApiError(
            "validation",
            `The category is for ${category.kind}, not ${input.kind}`,
          );
        }
      }
    }

    const { plnMinor, rate } = await this.inPln(input.amountMinor, account.currency, input.date);
    const at = this.stamp();
    return {
      ...input,
      currency: account.currency,
      toAmountMinor,
      plnMinor,
      rate,
      origin: keep?.origin ?? "app",
      createdAt: keep?.createdAt ?? at,
      updatedAt: at,
    };
  }

  async inPln(amountMinor: number, currency: string, date: string) {
    if (currency === "PLN") {
      return { plnMinor: amountMinor, rate: { source: "pln" as const, date, mid: 1 } };
    }
    const conversion = await this.rates.convert(amountMinor, currency, "PLN", date);
    return {
      plnMinor: conversion.resultMinor,
      rate: { source: conversion.source, date: conversion.date, mid: conversion.rate },
    };
  }

  /** Copies version 1 transactions once into a new PLN cash account, keeping the categories. */
  async importV1(uid: string) {
    if (await this.store.marks.get(uid, "import-v1")) {
      throw new ApiError("conflict", "The data of version 1 has already been imported");
    }
    const legacy = await this.store.legacy.transactions(uid);
    const categories = await this.categories(uid);
    const byKey = new Map(categories.map((category) => [category.key, category.id]));

    const at = this.stamp();
    const locale = await this.locale(uid);
    const account = await this.store.accounts.create(uid, {
      name: locale === "pl" ? "Portfel (wersja 1)" : "Wallet (version 1)",
      kind: "cash",
      currency: "PLN",
      openingBalanceMinor: 0,
      flowMinor: 0,
      archived: false,
      order: 0,
      createdAt: at,
      updatedAt: at,
    });

    const items: NewTransaction[] = [];
    let skipped = 0;
    for (const doc of legacy) {
      const date = `${doc.date?.year}-${String(doc.date?.month).padStart(2, "0")}-${String(doc.date?.day).padStart(2, "0")}`;
      let amountMinor: number;
      try {
        amountMinor = Math.abs(toMinor(doc.sum, "PLN"));
      } catch {
        skipped++;
        continue;
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || amountMinor === 0) {
        skipped++;
        continue;
      }
      const kind = doc.type === "+" ? "income" : "expense";
      const key = doc.category ? V1_CATEGORY_KEYS[doc.category] : undefined;
      items.push({
        accountId: account.id,
        kind,
        amountMinor,
        currency: "PLN",
        date,
        categoryId:
          (key && byKey.get(key)) ||
          byKey.get(kind === "income" ? "other-income" : "other") ||
          null,
        note: (doc.comment ?? "").slice(0, 200),
        payee: null,
        tags: [],
        toAccountId: null,
        toAmountMinor: null,
        plnMinor: amountMinor,
        rate: { source: "pln", date, mid: 1 },
        origin: "import-v1",
        createdAt: at,
        updatedAt: at,
      });
    }

    const imported = await this.store.transactions.createMany(uid, items);
    await this.store.marks.set(uid, "import-v1", { at, imported, skipped, accountId: account.id });
    return {
      imported,
      skipped,
      account: withBalance((await this.account(uid, account.id)) ?? account),
    };
  }
}
