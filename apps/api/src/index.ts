import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import { config } from "./config.js";
import { router } from "./routes.js";

const app = express();

app.use(
  cors({
    origin: config.corsOrigin,
    credentials: true
  })
);
app.use(cookieParser());
app.use(express.json({ limit: "25mb" }));
app.use("/api", router);

app.listen(config.port, () => {
  console.log(`CloudOS API listening on http://localhost:${config.port}`);
});
