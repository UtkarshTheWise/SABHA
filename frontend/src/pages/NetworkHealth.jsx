/**
 * How the network underneath is doing: the part of the design a vote's finality
 * rests on. On a QBFT network this shows the validator set, who proposed each
 * recent block and how often blocks arrive, all read from block headers, with no
 * administrative access. On any other network it shows what it can and says what
 * it cannot.
 */
import { useEffect, useState } from "react";

import { useLocale } from "../i18n/index.jsx";
import { formatAgo, formatDateTime, formatNumber, formatSeconds, shorten } from "../lib/format.js";
import { explorerAddress } from "../lib/networkParams.js";
import { averageBlockTime, decodeQbftExtraData, proposerCounts } from "../lib/qbft.js";
import { useChain, useNow } from "../state/chain.jsx";
import { useNetwork } from "../state/network.jsx";
import CopyButton from "../components/CopyButton.jsx";
import Icon from "../components/Icon.jsx";
import PageHeader from "../components/PageHeader.jsx";
import { ErrorState, Skeleton } from "../components/States.jsx";

const WINDOW = 12; // blocks read

export default function NetworkHealth() {
  const { t, lang } = useLocale();
  const { network, reader } = useNetwork();
  const { blockNumber, refresh } = useChain();
  const now = useNow(5000);
  const [state, setState] = useState({ phase: "loading" });

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const head = await reader.getBlockNumber();
        const numbers = Array.from({ length: Math.min(WINDOW, head + 1) }, (_, i) => head - i);
        const blocks = (await Promise.all(numbers.map((n) => reader.getBlock(n)))).filter(Boolean);
        const latest = blocks[0];

        let qbft = null;
        try {
          qbft = decodeQbftExtraData(latest.extraData);
        } catch {
          /* not a QBFT chain: the page says so */
        }
        let peers = null;
        if (qbft) {
          try {
            peers = parseInt(await reader.send("net_peerCount", []), 16);
          } catch {
            /* the public endpoint may not offer it */
          }
        }
        const rows = blocks.map((b) => ({ number: b.number, timestamp: b.timestamp, miner: b.miner, transactions: b.transactions.length }));
        live && setState({ phase: "ready", head, latest, qbft, peers, rows, average: averageBlockTime(rows), proposers: proposerCounts(rows) });
      } catch (error) {
        live && setState({ phase: "error", error });
      }
    })();
    return () => {
      live = false;
    };
  }, [reader, blockNumber]);

  const link = (address) => explorerAddress(network, address);

  return (
    <>
      <PageHeader title={t("network.title")} lede={t("network.lede")} />

      {state.phase === "loading" && <Skeleton rows={4} />}
      {state.phase === "error" && (
        <ErrorState title={t("network.error.title")} onRetry={refresh}>
          {t("network.error.body", { network: network.label })}
        </ErrorState>
      )}

      {state.phase === "ready" && (
        <div className="network">
          <section aria-labelledby="net-facts">
            <h2 id="net-facts">{network.label}</h2>
            <dl className="facts-list">
              <div>
                <dt>{t("network.chainId")}</dt>
                <dd className="num">{network.chainId}</dd>
              </div>
              <div>
                <dt>{t("network.address")}</dt>
                <dd className="num wrap">{network.rpcUrl}</dd>
              </div>
              <div>
                <dt>{t("network.height")}</dt>
                <dd className="num">{formatNumber(state.head, lang)}</dd>
              </div>
              <div>
                <dt>{t("network.latest")}</dt>
                <dd>{formatAgo(state.latest.timestamp, now, lang)}</dd>
              </div>
              {state.average !== null && (
                <div>
                  <dt>{t("network.blockTime")}</dt>
                  <dd>{formatSeconds(state.average, lang)}</dd>
                </div>
              )}
              {state.peers !== null && (
                <div>
                  <dt>{t("network.peers")}</dt>
                  <dd className="num">{state.peers}</dd>
                </div>
              )}
              <div>
                <dt>{t("network.fees")}</dt>
                <dd>{network.zeroGas ? t("network.feesFree") : t("network.feesPaid", { currency: network.currency.symbol })}</dd>
              </div>
            </dl>
            {state.qbft && state.average !== null && state.average > 10 && <p className="muted">{t("network.idleNote")}</p>}
          </section>

          {state.qbft ? (
            <section aria-labelledby="net-validators">
              <h2 id="net-validators">{t("network.validators.title")}</h2>
              <p className="muted">{t("network.validators.body", { count: state.qbft.validators.length })}</p>
              <div className="scroll-x">
                <table className="ledger">
                  <caption className="visually-hidden">{t("network.validators.title")}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{t("network.validators.address")}</th>
                      <th scope="col" className="num">
                        {t("network.validators.proposed", { count: state.rows.length })}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.qbft.validators.map((address) => {
                      const count = state.proposers.find((p) => p.address.toLowerCase() === address.toLowerCase())?.count ?? 0;
                      return (
                        <tr key={address}>
                          <th scope="row">
                            <span className="num">{shorten(address, 8, 6)}</span> <CopyButton value={address} label={t("copy.copy")} />
                          </th>
                          <td className="num">{formatNumber(count, lang)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {state.qbft.client && <p className="muted">{t("network.client", { client: state.qbft.client })}</p>}
            </section>
          ) : (
            <p className="muted">
              <Icon name="info" /> {t("network.notQbft")}
            </p>
          )}

          <section aria-labelledby="net-blocks">
            <h2 id="net-blocks">{t("network.blocks.title")}</h2>
            <div className="scroll-x">
              <table className="ledger">
                <caption className="visually-hidden">{t("network.blocks.title")}</caption>
                <thead>
                  <tr>
                    <th scope="col" className="num">
                      {t("network.blocks.number")}
                    </th>
                    <th scope="col">{t("network.blocks.time")}</th>
                    {state.qbft && <th scope="col">{t("network.blocks.proposer")}</th>}
                    <th scope="col" className="num">
                      {t("network.blocks.transactions")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {state.rows.map((row) => (
                    <tr key={row.number}>
                      <th scope="row" className="num">
                        {formatNumber(row.number, lang)}
                      </th>
                      <td>{formatDateTime(row.timestamp, lang)}</td>
                      {state.qbft && <td className="num">{shorten(row.miner, 8, 6)}</td>}
                      <td className="num">{row.transactions}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section aria-labelledby="net-contracts">
            <h2 id="net-contracts">{t("network.contracts.title")}</h2>
            <dl className="facts-list">
              {[
                ["DirectDemocracy", t("network.contracts.ballots")],
                ["MemberRegistry", t("network.contracts.roster")],
              ].map(([name, label]) => {
                const entry = network.contracts[name];
                return (
                  <div key={name}>
                    <dt>{label}</dt>
                    <dd>
                      <span className="num wrap">{entry.address}</span>
                      <span className="muted block">{t("network.contracts.block", { block: formatNumber(entry.block, lang) })}</span>
                      {link(entry.address) && (
                        <a href={link(entry.address)} target="_blank" rel="noreferrer">
                          {t("tx.explorer")}
                        </a>
                      )}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </section>
        </div>
      )}
    </>
  );
}
