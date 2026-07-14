package team.acg.access.assets.asset;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;
import team.acg.access.assets.store.PortalReferenceCatalog;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class AssetImportCommandLimitTest {
    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void acceptsUpdateImportsAboveTheOrdinaryFiveHundredAssetLimit() {
        AssetRepository repository = mock(AssetRepository.class);
        PortalReferenceCatalog references = mock(PortalReferenceCatalog.class);
        when(references.categories()).thenReturn(Set.of("电脑"));
        when(references.locations()).thenReturn(Set.of("总部"));
        List<JsonNode> assets = new ArrayList<>();
        List<String> ids = new ArrayList<>();
        Map<String, AssetRepository.AssetRecord> records = new LinkedHashMap<>();
        ObjectNode fields = mapper.createObjectNode();
        ObjectNode operations = fields.putObject("operations");
        for (int index = 0; index < 501; index++) {
            String id = "A-" + index;
            ObjectNode asset = mapper.createObjectNode()
                .put("id", id).put("name", "资产" + index).put("category", "电脑")
                .put("location", "总部").put("owner", "未分配").put("ownerSubject", "")
                .put("status", "空闲");
            asset.putArray("lifecycle");
            assets.add(asset);
            ids.add(id);
            records.put(id, new AssetRepository.AssetRecord(asset, 1L));
            operations.putObject(id).put("name", "更新资产" + index).put("date", "2026-07-13");
        }
        when(repository.findAll()).thenReturn(assets);
        when(repository.findAllRecords()).thenReturn(records);
        AssetService service = new AssetService(
            repository, mapper, references, mock(AssetCodeGenerator.class), mock(AssetWorkflowPolicy.class),
            mock(AssetOperationRepository.class));

        List<JsonNode> updated = service.execute("update-import", ids, fields);

        assertThat(updated).hasSize(501);
        assertThat(updated).allMatch(asset -> asset.path("name").asText().startsWith("更新资产"));
    }

    @Test
    void rejectsImportsAboveFiveThousandAssets() {
        AssetService service = new AssetService(mock(AssetRepository.class), mapper,
            mock(PortalReferenceCatalog.class), mock(AssetCodeGenerator.class), mock(AssetWorkflowPolicy.class),
            mock(AssetOperationRepository.class));

        List<String> ids = java.util.stream.IntStream.range(0, 5_001)
            .mapToObj(index -> "A-" + index).toList();

        assertThatThrownBy(() -> service.execute("update-import", ids, mapper.createObjectNode()))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessage("Asset command requires between 1 and 5000 asset ids");
    }
}
