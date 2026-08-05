// Declarações mínimas de `ioredis-mock` para typecheck.
// Não precisamos da API completa — só o suficiente para os testes do SDK.
declare module 'ioredis-mock' {
  interface RedisMock {
    set(key: string, value: string | number): Promise<'OK' | null>;
    get(key: string): Promise<string | null>;
    mget(...keys: string[]): Promise<Array<string | null>>;
    publish(channel: string, message: string): Promise<number>;
    subscribe(channel: string): Promise<unknown>;
    unsubscribe(channel?: string): Promise<unknown>;
    exists(...keys: string[]): Promise<number>;
    quit(): Promise<'OK'>;
    duplicate(): RedisMock;
    on(event: 'message', listener: (channel: string, message: string) => void): this;
    on(event: string, listener: (...args: unknown[]) => void): this;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const RedisMock: new (port?: number | string, host?: string) => RedisMock;
  export default RedisMock;
}
