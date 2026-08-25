package team.acg.access.assets.sync;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class LegacyAmsSignerTest {
    @Test
    void signsTheVendorJavaSampleCanonicalParameterOrderWithSha1() {
        assertThat(LegacyAmsSigner.sign("681b7658fa9c253635884f419d81cb0d", 1560680807326L,
            "{\"companyName\":\"测试对外接口有限公司3\",\"companyCode\":\"openCode3\"}"))
            .isEqualTo("f644d890a27d52886cf2ed4dc8e28c9942e0cb74");
    }
}
