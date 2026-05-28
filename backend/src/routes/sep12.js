/**
 * SEP-12 KYC routes.
 *
 *   GET    /sep12/customer            — fetch a customer's KYC status
 *   PUT    /sep12/customer            — create/update KYC (signature-gated)
 *   DELETE /sep12/customer/:account   — delete a customer's KYC record
 *
 * All KYC business logic lives in lib/sep12-kyc.js; this layer only maps
 * HTTP <-> service calls and translates KycError into responses (#592).
 */

import express from "express";
import {
  putCustomer,
  getCustomer,
  deleteCustomer,
  KycError,
} from "../lib/sep12-kyc.js";
import { logger } from "../lib/logger.js";

function handleError(err, res) {
  if (err instanceof KycError) {
    const body = { error: err.code, message: err.message };
    if (err.retryable) body.retryable = true;
    res.status(err.httpStatus).json(body);
    return;
  }
  // Never leak internals; field values are not logged (#593).
  logger.error({ err: err.message }, "sep12 unexpected error");
  res.status(500).json({ error: "INTERNAL_ERROR", message: "Unexpected error" });
}

export default function createSep12Router() {
  const router = express.Router();

  router.get("/sep12/customer", async (req, res) => {
    try {
      const data = await getCustomer({
        account: req.query.account,
        memo: req.query.memo ?? "",
      });
      res.json({
        id: data.id,
        account: data.account,
        status: data.status,
        fields: data.fields,
        provided_fields: Object.keys(data.fields || {}),
      });
    } catch (err) {
      handleError(err, res);
    }
  });

  router.put("/sep12/customer", async (req, res) => {
    try {
      const { account, memo, timestamp, signature, fields } = req.body ?? {};
      const result = await putCustomer({
        account,
        memo: memo ?? "",
        timestamp,
        signature,
        fields,
      });
      res.status(202).json(result);
    } catch (err) {
      handleError(err, res);
    }
  });

  router.delete("/sep12/customer/:account", async (req, res) => {
    try {
      const result = await deleteCustomer({
        account: req.params.account,
        memo: req.query.memo ?? "",
      });
      res.json(result);
    } catch (err) {
      handleError(err, res);
    }
  });

  return router;
}
