/**
 * What happened to the last write, and what it means. After a transaction the
 * member sees the hash, the block and the gas, a link to the explorer where the
 * network has one, and a sentence on what is now true. A failure says why in plain
 * words and keeps the technical message behind a disclosure.
 */
import { formatEther } from "ethers";

import { useLocale } from "../i18n/index.jsx";
import { formatGas } from "../lib/format.js";
import { explorerTx } from "../lib/networkParams.js";
import { useNetwork } from "../state/network.jsx";
import CopyButton from "./CopyButton.jsx";
import Icon from "./Icon.jsx";

export default function TxPanel({ tx, onDismiss }) {
  const { t, lang } = useLocale();
  const { network } = useNetwork();
  if (!tx) return null;

  const busy = tx.phase === "wallet" || tx.phase === "pending";
  const failed = tx.phase === "failed";
  const link = explorerTx(network, tx.hash);

  const status = {
    wallet: t("tx.wallet"),
    pending: t("tx.pending"),
    confirmed: t("tx.confirmed", { block: tx.blockNumber }),
    failed: tx.blockNumber !== undefined ? t("tx.failedInBlock", { block: tx.blockNumber }) : t("tx.failed"),
  }[tx.phase];

  const fee =
    tx.fee === undefined
      ? null
      : network.zeroGas || tx.fee === 0n
        ? t("tx.free")
        : `${formatEther(tx.fee)} ${network.currency.symbol}`;

  return (
    <section className={`tx tx--${tx.phase}`} aria-labelledby="tx-title" role={failed ? "alert" : "status"}>
      <h3 id="tx-title">{t("tx.title")}</h3>
      <p className="tx__status">
        <Icon name={failed ? "alert" : tx.phase === "confirmed" ? "check" : "info"} /> {status}
      </p>

      {failed && tx.error && <p>{t(tx.error.key, tx.error.params)}</p>}
      {tx.phase === "confirmed" && <p>{t(`tx.what.${tx.kind}`)}</p>}

      {tx.hash && (
        <dl className="tx__facts">
          <div>
            <dt>{t("tx.hash")}</dt>
            <dd className="num wrap">{tx.hash}</dd>
            <dd className="row">
              <CopyButton value={tx.hash} label={t("tx.copyHash")} />
              {link && (
                <a className="btn btn--quiet btn--small" href={link} target="_blank" rel="noreferrer">
                  <Icon name="external" /> {t("tx.explorer")}
                </a>
              )}
            </dd>
          </div>
          {tx.blockNumber !== undefined && (
            <div>
              <dt>{t("tx.block")}</dt>
              <dd className="num">{tx.blockNumber}</dd>
            </div>
          )}
          {tx.gasUsed !== undefined && (
            <div>
              <dt>{t("tx.gas")}</dt>
              <dd className="num">{formatGas(tx.gasUsed, lang)}</dd>
            </div>
          )}
          {fee && (
            <div>
              <dt>{t("tx.fee")}</dt>
              <dd>{fee}</dd>
            </div>
          )}
        </dl>
      )}

      {failed && tx.error?.technical && (
        <details className="tx__details">
          <summary>{t("tx.details")}</summary>
          <pre className="wrap">{tx.error.technical}</pre>
        </details>
      )}

      {!busy && (
        <button type="button" className="btn btn--quiet btn--small" onClick={onDismiss}>
          {t("tx.dismiss")}
        </button>
      )}
    </section>
  );
}
