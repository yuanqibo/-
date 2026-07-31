package team.acg.access.assets.web;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

@Controller
public class SpaController {
    @GetMapping(value = {
        "/", "/login", "/login/**", "/no-permission", "/workspace/**",
        "/assets", "/assets/inbound", "/assets/receive-return", "/assets/borrow-return",
        "/assets/stocktake", "/assets/disposals", "/assets/consumables", "/assets/repairs", "/assets/contracts",
        "/assets/settings", "/assets/settings/locations", "/assets/settings/categories",
        "/assets/settings/code-rules", "/assets/settings/label-templates",
        "/requests", "/signatures", "/system", "/system/**"
    })
    public String index() {
        return "forward:/index.html";
    }
}
