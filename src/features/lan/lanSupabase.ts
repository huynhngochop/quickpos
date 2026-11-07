/**
 * Client "giống Supabase" cho máy nhân viên: cùng giao diện from()/rpc()/functions/channel()/auth mà app đang dùng,
 * nhưng mọi lệnh gửi tới máy chủ quán qua LanClient. Màn hình và features/*\/api.ts không phải sửa.
 */
import { SELECT_METHODS, type LanResult } from './protocol';
import type { LanClient } from './client';

type Result = LanResult;

class LanQuery implements PromiseLike<Result> {
  private ops: { m: string; a: unknown[] }[] = [];
  constructor(private client: LanClient, private table: string) {
    return new Proxy(this, {
      get(target, prop, recv) {
        if (prop === 'then' || prop in target) return Reflect.get(target, prop, recv);
        if (typeof prop === 'string' && prop === 'abortSignal') return () => recv;
        if (typeof prop === 'string' && SELECT_METHODS.has(prop)) {
          return (...a: unknown[]) => {
            target.ops.push({ m: prop, a });
            return recv;
          };
        }
        return undefined;
      },
    });
  }
  then<A = Result, B = never>(ok?: ((v: Result) => A | PromiseLike<A>) | null, no?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return this.client.request({ kind: 'select', table: this.table, ops: this.ops }).then(ok, no);
  }
}

class LanRpc implements PromiseLike<Result> {
  constructor(private client: LanClient, private name: string, private args: Record<string, unknown>) {}
  abortSignal() {
    return this;
  }
  then<A = Result, B = never>(ok?: ((v: Result) => A | PromiseLike<A>) | null, no?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return this.client.request({ kind: 'rpc', name: this.name, args: this.args }).then(ok, no);
  }
}

export function createLanSupabase(client: LanClient, onSignOut: () => void) {
  const p = client.info;
  const session = { access_token: 'lan', user: { id: p.userId, phone: '' } };
  let signedIn = true;
  const authListeners = new Set<(event: string, s: unknown) => void>();
  return {
    from: (table: string) => new LanQuery(client, table),
    rpc: (name: string, args: Record<string, unknown> = {}) => new LanRpc(client, name, args),
    functions: {
      invoke: (name: string, opts: { body: Record<string, unknown> }) => client.request({ kind: 'fn', name, body: opts?.body ?? {} }),
    },
    auth: {
      async getSession() {
        return { data: { session: signedIn ? session : null }, error: null };
      },
      async getUser() {
        return { data: { user: signedIn ? session.user : null }, error: null };
      },
      async signInWithOtp() {
        return { data: {}, error: { message: 'QP_FORBIDDEN' } };
      },
      async verifyOtp() {
        return { data: { user: null, session: null }, error: { message: 'QP_FORBIDDEN' } };
      },
      /** Máy nhân viên "đăng xuất" = ngắt khỏi máy chủ quán (ghép lại bằng mã QR mới) */
      async signOut() {
        signedIn = false;
        client.close();
        onSignOut();
        for (const l of authListeners) l('SIGNED_OUT', null);
        return { error: null };
      },
      onAuthStateChange(cb: (event: string, s: unknown) => void) {
        authListeners.add(cb);
        return { data: { subscription: { unsubscribe: () => authListeners.delete(cb) } } };
      },
      startAutoRefresh() {},
      stopAutoRefresh() {},
    },
    channel(_name: string) {
      const handlers: ((payload: { new: Record<string, unknown> }) => void)[] = [];
      let off: (() => void) | null = null;
      const ch = {
        on(_type: string, _filter: unknown, cb: (payload: { new: Record<string, unknown> }) => void) {
          handlers.push(cb);
          return ch;
        },
        subscribe(cb?: (status: string) => void) {
          off = client.onPush((row) => {
            for (const h of handlers) h({ new: row });
          });
          client.warmUp();
          setTimeout(() => cb?.('SUBSCRIBED'), 0);
          return ch;
        },
        _off() {
          off?.();
        },
      };
      return ch;
    },
    async removeChannel(ch: { _off: () => void }) {
      ch._off();
      return 'ok';
    },
  };
}
