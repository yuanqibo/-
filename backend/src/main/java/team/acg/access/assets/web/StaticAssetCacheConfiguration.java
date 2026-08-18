package team.acg.access.assets.web;

import java.time.Duration;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.CacheControl;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class StaticAssetCacheConfiguration implements WebMvcConfigurer {
    private static final CacheControl IMMUTABLE_ASSET_CACHE = CacheControl.maxAge(Duration.ofDays(365))
        .cachePublic()
        .immutable();

    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        registry.addResourceHandler("/build-assets/**")
            .addResourceLocations("classpath:/static/build-assets/", "file:./frontend-dist/build-assets/")
            .setCacheControl(IMMUTABLE_ASSET_CACHE);
    }
}
