package team.acg.access.assets.web;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

@Controller
public class SpaController {
    @GetMapping(value = {"/", "/login", "/login/**", "/no-permission", "/workspace/**"})
    public String index() {
        return "forward:/index.html";
    }
}
