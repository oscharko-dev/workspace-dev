import type { StageService } from "../pipeline/stage-service.js";
import { createTemplatePrepareService } from "./template-prepare-core.js";

export const TemplatePrepareService: StageService<void> = createTemplatePrepareService();
