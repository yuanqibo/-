package team.acg.access.assets.asset;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import com.fasterxml.jackson.databind.ObjectMapper;
import team.acg.access.assets.store.AppStoreRepository;

import java.util.Map;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.hamcrest.Matchers.matchesPattern;

@SpringBootTest
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_EACH_TEST_METHOD)
@ActiveProfiles("test")
@TestPropertySource(properties = "spring.datasource.url=jdbc:h2:mem:asset-test;MODE=MySQL;DB_CLOSE_DELAY=-1")
class AssetControllerTest {
    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired AppStoreRepository storeRepository;
    @Autowired ObjectMapper mapper;

    @BeforeEach
    void clearAssets() {
        jdbc.update("DELETE FROM asset_audit_log");
        jdbc.update("DELETE FROM asset_record");
        var signSettings = mapper.createObjectNode();
        signSettings.set("assetReceive", mapper.createObjectNode().put("employeeSign", false));
        signSettings.set("assetBorrow", mapper.createObjectNode().put("employeeSign", false));
        signSettings.set("assetHandover", mapper.createObjectNode().put("employeeSign", true));
        var selfService = mapper.createObjectNode();
        selfService.set("signSettings", signSettings);
        storeRepository.saveAll(Map.of(
            "assetCategoryTree", mapper.createArrayNode().add(mapper.createObjectNode()
                .put("id", "cat-computer").put("name", "电脑").put("code", "PC").set("children", mapper.createArrayNode())),
            "assetLocationTree", mapper.createArrayNode().add(mapper.createObjectNode()
                .put("id", "loc-hq").put("name", "总部").set("children", mapper.createArrayNode())),
            "assetPortalSelfServiceSettingsV9", selfService));
    }

    @Test
    void persistsAValidatedAsset() throws Exception {
        mvc.perform(post("/api/assets").contentType(MediaType.APPLICATION_JSON).content("""
            {"item":{"id":"PC-001","name":"开发电脑","category":"电脑","location":"总部","price":5000}}
            """))
            .andExpect(status().isOk()).andExpect(jsonPath("$.item.status").value("空闲"));

        mvc.perform(get("/api/assets"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.items[0].id").value("PC-001"));
    }

    @Test
    void excludesDisposedAssetsFromTheAssetCatalogAndItsTotal() throws Exception {
        mvc.perform(post("/api/assets").contentType(MediaType.APPLICATION_JSON).content("""
            {"item":{"id":"PC-ACTIVE","name":"在册电脑","category":"电脑","location":"总部"}}
            """))
            .andExpect(status().isOk());

        var disposed = mapper.createObjectNode()
            .put("id", "PC-DISPOSED").put("name", "已处置电脑").put("category", "电脑")
            .put("location", "总部").put("owner", "未分配").put("status", "已处置");
        jdbc.update("INSERT INTO asset_record (asset_id, status, document, version, updated_at) VALUES (?, ?, ?, ?, ?)",
            "PC-DISPOSED", "已处置", disposed.toString(), 1L, java.sql.Timestamp.from(java.time.Instant.now()));

        mvc.perform(get("/api/assets"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.items.length()").value(1))
            .andExpect(jsonPath("$.items[0].id").value("PC-ACTIVE"))
            .andExpect(jsonPath("$.items[?(@.id == 'PC-DISPOSED')]").isEmpty())
            .andExpect(jsonPath("$.disposedCount").value(1));
    }

    @Test
    void replacesOnlyTheAssetCatalogAndNormalizesImportedStatuses() throws Exception {
        mvc.perform(post("/api/assets/import").contentType(MediaType.APPLICATION_JSON).content("""
            {"items":[
              {"id":"PC-KEEP","name":"保留资产","category":"电脑","location":"总部","supplier":"原供应商"},
              {"id":"PC-REMOVE","name":"移除资产","category":"电脑","location":"总部"}
            ]}
            """))
            .andExpect(status().isOk());

        mvc.perform(post("/api/assets/replace").contentType(MediaType.APPLICATION_JSON).content("""
            {"items":[
              {"id":"PC-KEEP","name":"更新资产","category":"电脑","status":"领用","owner":"未分配","brand":"新品牌"},
              {"id":"PC-NEW","name":"","category":"电脑","status":"借用","owner":"未分配"},
              {"id":"PC-IDLE","name":"空闲资产","category":"电脑","status":"空闲","owner":"未分配",
                "ownerSubject":"stale-user","company":"历史使用公司","companyUnionId":"stale-company",
                "department":"历史使用部门","departmentUnionId":"stale-department","email":"stale@example.com",
                "receiveDate":"2026-07-01","ownerCompany":"资产所属公司"}
            ]}
            """))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.count").value(3))
            .andExpect(jsonPath("$.items[?(@.id == 'PC-KEEP')].status").value("领用"))
            .andExpect(jsonPath("$.items[?(@.id == 'PC-KEEP')].location").value("总部"))
            .andExpect(jsonPath("$.items[?(@.id == 'PC-KEEP')].supplier").value("原供应商"))
            .andExpect(jsonPath("$.items[?(@.id == 'PC-NEW')].status").value("借用"))
            .andExpect(jsonPath("$.items[?(@.id == 'PC-NEW')].name").value("电脑资产"))
            .andExpect(jsonPath("$.items[?(@.id == 'PC-IDLE')].ownerSubject").value(""))
            .andExpect(jsonPath("$.items[?(@.id == 'PC-IDLE')].company").value(""))
            .andExpect(jsonPath("$.items[?(@.id == 'PC-IDLE')].department").value(""))
            .andExpect(jsonPath("$.items[?(@.id == 'PC-IDLE')].email").value(""))
            .andExpect(jsonPath("$.items[?(@.id == 'PC-IDLE')].receiveDate").value(""))
            .andExpect(jsonPath("$.items[?(@.id == 'PC-IDLE')].ownerCompany").value("资产所属公司"));

        mvc.perform(get("/api/assets"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.items.length()").value(3))
            .andExpect(jsonPath("$.items[?(@.id == 'PC-REMOVE')]").isEmpty());
    }

    @Test
    void fullCatalogReplacementResetsOldBusinessHistoryWithoutCreatingSyntheticOperations() throws Exception {
        mvc.perform(post("/api/assets").contentType(MediaType.APPLICATION_JSON).content("""
            {"item":{"id":"PC-OLD","name":"旧资产","category":"电脑","location":"总部"}}
            """))
            .andExpect(status().isOk());
        java.sql.Timestamp now = java.sql.Timestamp.from(java.time.Instant.now());
        jdbc.update("INSERT INTO approval_request_record (request_id, request_type, request_status, applicant_subject, "
                + "applicant_directory_subject, approval_no, biz_no, document, version, created_at, updated_at) "
                + "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            "REQ-OLD", "资产领用", "已同意", "user-old", "user-old", "", "REQ-OLD",
            "{\"id\":\"REQ-OLD\",\"type\":\"资产领用\",\"status\":\"已同意\"}", 1L, now, now);
        jdbc.update("INSERT INTO asset_stocktake_record (record_id, document, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
            "STOCK-OLD", "{\"id\":\"STOCK-OLD\"}", 1L, now, now);

        mvc.perform(post("/api/assets/replace").contentType(MediaType.APPLICATION_JSON).content("""
            {"resetHistory":true,"items":[
              {"id":"PC-NEW","name":"新资产","category":"电脑","location":"总部","status":"空闲","owner":"未分配"}
            ]}
            """))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.historyReset").value(true))
            .andExpect(jsonPath("$.items.length()").value(1))
            .andExpect(jsonPath("$.items[0].id").value("PC-NEW"));

        org.assertj.core.api.Assertions.assertThat(count("asset_record")).isEqualTo(1);
        org.assertj.core.api.Assertions.assertThat(count("asset_operation_record")).isZero();
        org.assertj.core.api.Assertions.assertThat(count("approval_request_record")).isZero();
        org.assertj.core.api.Assertions.assertThat(count("asset_stocktake_record")).isZero();
        org.assertj.core.api.Assertions.assertThat(count("asset_audit_log")).isZero();
        Integer oldOperations = jdbc.queryForObject("SELECT COUNT(*) FROM asset_operation_record WHERE asset_id = ?", Integer.class, "PC-OLD");
        org.assertj.core.api.Assertions.assertThat(oldOperations).isZero();
    }

    @Test
    void replacementRemovesDisposedAssetsMissingFromTheNewCatalog() throws Exception {
        var disposed = mapper.createObjectNode()
            .put("id", "PC-DISPOSED").put("name", "已处置电脑").put("category", "电脑")
            .put("location", "总部").put("owner", "未分配").put("status", "已处置");
        jdbc.update("INSERT INTO asset_record (asset_id, status, document, version, updated_at) VALUES (?, ?, ?, ?, ?)",
            "PC-DISPOSED", "已处置", disposed.toString(), 1L, java.sql.Timestamp.from(java.time.Instant.now()));

        mvc.perform(post("/api/assets/replace").contentType(MediaType.APPLICATION_JSON).content("""
            {"items":[
              {"id":"PC-ACTIVE","name":"在册电脑","category":"电脑","status":"空闲","owner":"未分配"}
            ]}
            """))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.count").value(1))
            .andExpect(jsonPath("$.items.length()").value(1))
            .andExpect(jsonPath("$.items[0].id").value("PC-ACTIVE"));

        mvc.perform(get("/api/assets"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.items.length()").value(1))
            .andExpect(jsonPath("$.items[0].id").value("PC-ACTIVE"))
            .andExpect(jsonPath("$.disposedCount").value(0));

        org.assertj.core.api.Assertions.assertThat(jdbc.queryForObject(
            "SELECT COUNT(*) FROM asset_record WHERE asset_id = ?", Integer.class, "PC-DISPOSED"))
            .isZero();
    }

    @Test
    void replacementReactivatesDisposedCodesWithoutStaleWorkflowFields() throws Exception {
        var disposed = mapper.createObjectNode()
            .put("id", "PC-DISPOSED").put("name", "已处置电脑").put("category", "电脑")
            .put("location", "总部").put("owner", "未分配").put("status", "已处置")
            .put("disposalPreviousStatus", "空闲").put("disposalId", "DSP-OLD")
            .put("disposalStartedAt", "2026-08-01").put("disposedAt", "2026-08-02");
        jdbc.update("INSERT INTO asset_record (asset_id, status, document, version, updated_at) VALUES (?, ?, ?, ?, ?)",
            "PC-DISPOSED", "已处置", disposed.toString(), 1L, java.sql.Timestamp.from(java.time.Instant.now()));

        mvc.perform(post("/api/assets/replace").contentType(MediaType.APPLICATION_JSON).content("""
            {"items":[
              {"id":"PC-DISPOSED","name":"重新入册电脑","category":"电脑","status":"空闲","owner":"未分配"}
            ]}
            """))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.items[0].status").value("空闲"))
            .andExpect(jsonPath("$.items[0].name").value("重新入册电脑"));

        String persisted = jdbc.queryForObject(
            "SELECT document FROM asset_record WHERE asset_id = ?", String.class, "PC-DISPOSED");
        org.assertj.core.api.Assertions.assertThat(persisted)
            .doesNotContain("disposalPreviousStatus", "disposalId", "disposalStartedAt", "disposedAt");
    }

    @Test
    void executesLifecycleCommandsWithServerControlledStatusAndHistory() throws Exception {
        mvc.perform(post("/api/assets").contentType(MediaType.APPLICATION_JSON).content("""
            {"item":{"id":"PC-CMD","name":"命令电脑","category":"电脑","location":"总部"}}
            """))
            .andExpect(status().isOk());

        mvc.perform(post("/api/assets/commands/receive").contentType(MediaType.APPLICATION_JSON).content("""
            {"assetIds":["PC-CMD"],"fields":{"receiver":"李雷","receiverSubject":"user-1","department":"研发部","company":"默认公司","location":"总部","date":"2026-07-10"}}
            """))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.items[0].status").value("领用"))
            .andExpect(jsonPath("$.items[0].owner").value("李雷"))
            .andExpect(jsonPath("$.items[0].lifecycle[1][0]").value(matchesPattern("\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}")))
            .andExpect(jsonPath("$.items[0].lifecycle[1][1]").value("资产领用"));

        mvc.perform(post("/api/assets/commands/borrow").contentType(MediaType.APPLICATION_JSON).content("""
            {"assetIds":["PC-CMD"],"fields":{"borrower":"韩梅梅","location":"总部","date":"2026-07-10","expectedReturnDate":"2026-07-20"}}
            """))
            .andExpect(status().isBadRequest());

        mvc.perform(post("/api/assets/commands/return").contentType(MediaType.APPLICATION_JSON).content("""
            {"assetIds":["PC-CMD"],"fields":{"company":"不应保留的公司","department":"不应保留的部门",
              "location":"总部","date":"2026-07-11","operator":"管理员"}}
            """))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.items[0].status").value("空闲"))
            .andExpect(jsonPath("$.items[0].owner").value("未分配"))
            .andExpect(jsonPath("$.items[0].ownerSubject").value(""))
            .andExpect(jsonPath("$.items[0].company").value(""))
            .andExpect(jsonPath("$.items[0].department").value(""))
            .andExpect(jsonPath("$.items[0].receiveDate").value(""));

        mvc.perform(get("/api/asset-operations").param("type", "RETURN"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.items[0].company").value("默认公司"))
            .andExpect(jsonPath("$.items[0].department").value("研发部"));
    }

    @Test
    void receiveAndBorrowCanOnlyStartFromAnIdleAsset() throws Exception {
        mvc.perform(post("/api/assets").contentType(MediaType.APPLICATION_JSON).content("""
            {"item":{"id":"PC-RECEIVED","name":"已领用电脑","category":"电脑","location":"总部"}}
            """))
            .andExpect(status().isOk());
        mvc.perform(post("/api/assets/commands/receive").contentType(MediaType.APPLICATION_JSON).content("""
            {"assetIds":["PC-RECEIVED"],"fields":{"receiver":"李雷","receiverSubject":"user-1",
              "location":"总部","date":"2026-07-10"}}
            """))
            .andExpect(status().isOk());
        mvc.perform(post("/api/assets/commands/borrow").contentType(MediaType.APPLICATION_JSON).content("""
            {"assetIds":["PC-RECEIVED"],"fields":{"borrower":"韩梅梅","borrowerSubject":"user-2",
              "location":"总部","date":"2026-07-11","expectedReturnDate":"2026-07-20"}}
            """))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("Asset is not eligible for this operation: PC-RECEIVED"));

        mvc.perform(post("/api/assets").contentType(MediaType.APPLICATION_JSON).content("""
            {"item":{"id":"PC-BORROWED","name":"已借用电脑","category":"电脑","location":"总部"}}
            """))
            .andExpect(status().isOk());
        mvc.perform(post("/api/assets/commands/borrow").contentType(MediaType.APPLICATION_JSON).content("""
            {"assetIds":["PC-BORROWED"],"fields":{"borrower":"韩梅梅","borrowerSubject":"user-2",
              "location":"总部","date":"2026-07-11","expectedReturnDate":"2026-07-20"}}
            """))
            .andExpect(status().isOk());
        mvc.perform(post("/api/assets/commands/receive").contentType(MediaType.APPLICATION_JSON).content("""
            {"assetIds":["PC-BORROWED"],"fields":{"receiver":"李雷","receiverSubject":"user-1",
              "location":"总部","date":"2026-07-12"}}
            """))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("Asset is not eligible for this operation: PC-BORROWED"));

        String document = jdbc.queryForObject(
            "SELECT document FROM asset_record WHERE asset_id = ?", String.class, "PC-BORROWED");
        var nonIdle = (com.fasterxml.jackson.databind.node.ObjectNode) mapper.readTree(document);
        nonIdle.put("status", "闲置");
        nonIdle.put("owner", "未分配");
        nonIdle.put("ownerSubject", "");
        jdbc.update("UPDATE asset_record SET status = ?, document = ? WHERE asset_id = ?",
            "闲置", mapper.writeValueAsString(nonIdle), "PC-BORROWED");
        mvc.perform(post("/api/assets/commands/receive").contentType(MediaType.APPLICATION_JSON).content("""
            {"assetIds":["PC-BORROWED"],"fields":{"receiver":"李雷","receiverSubject":"user-1",
              "location":"总部","date":"2026-07-12"}}
            """))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("Asset is not eligible for this operation: PC-BORROWED"));
    }

    @Test
    void createsAssetWithoutTrustingClientStatusOrLifecycle() throws Exception {
        mvc.perform(post("/api/assets").contentType(MediaType.APPLICATION_JSON).content("""
            {"item":{"id":"PC-NEW","name":"新电脑","category":"电脑","location":"总部","owner":"",
              "company":"历史使用公司","department":"历史使用部门","receiveDate":"2026-07-01",
              "status":"已报废","lifecycle":[["x","伪造","伪造"]]}}
            """))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.item.status").value("空闲"))
            .andExpect(jsonPath("$.item.company").value(""))
            .andExpect(jsonPath("$.item.department").value(""))
            .andExpect(jsonPath("$.item.receiveDate").value(""))
            .andExpect(jsonPath("$.item.lifecycle[0][1]").value("资产入库"));
    }

    @Test
    void rejectsReferencesOutsideTheServerCatalog() throws Exception {
        mvc.perform(post("/api/assets").contentType(MediaType.APPLICATION_JSON).content("""
            {"item":{"id":"PC-BAD-CATEGORY","name":"未知资产","category":"不存在","location":"总部"}}
            """))
            .andExpect(status().isBadRequest());

        mvc.perform(post("/api/assets").contentType(MediaType.APPLICATION_JSON).content("""
            {"item":{"id":"PC-BAD-LOCATION","name":"未知位置资产","category":"电脑","location":"不存在"}}
            """))
            .andExpect(status().isBadRequest());
    }

    @Test
    void rejectsPersonAssignmentsWithoutAStableSubject() throws Exception {
        mvc.perform(post("/api/assets").contentType(MediaType.APPLICATION_JSON).content("""
            {"item":{"id":"PC-NO-SUBJECT","name":"人员校验资产","category":"电脑","location":"总部"}}
            """))
            .andExpect(status().isOk());

        mvc.perform(post("/api/assets/commands/receive").contentType(MediaType.APPLICATION_JSON).content("""
            {"assetIds":["PC-NO-SUBJECT"],"fields":{"receiver":"伪造姓名","location":"总部","date":"2026-07-10"}}
            """))
            .andExpect(status().isBadRequest());
    }

    @Test
    void handoverRequiresSignatureAndCancellationRestoresThePreviousOwner() throws Exception {
        mvc.perform(post("/api/assets").contentType(MediaType.APPLICATION_JSON).content("""
            {"item":{"id":"PC-HANDOVER","name":"交接资产","category":"电脑","location":"总部",
              "owner":"原责任人","ownerSubject":"user-old","company":"原公司","department":"原部门",
              "ownerCompany":"资产所属公司"}}
            """))
            .andExpect(status().isOk());

        mvc.perform(post("/api/assets/commands/handover").contentType(MediaType.APPLICATION_JSON).content("""
            {"assetIds":["PC-HANDOVER"],"fields":{"receiver":"新责任人","receiverSubject":"user-new",
              "location":"总部","handoverType":"员工交接","date":"2026-07-10"}}
            """))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.items[0].status").value("交接待签字"))
            .andExpect(jsonPath("$.items[0].owner").value("新责任人"));
        String firstHandoverId = operationId("PC-HANDOVER", "HANDOVER");

        mvc.perform(get("/api/asset-operations").param("type", "HANDOVER"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.items[0].handoverType").value("员工交接"))
            .andExpect(jsonPath("$.items[0].previousParty").value("原责任人"))
            .andExpect(jsonPath("$.items[0].previousCompany").value("原公司"))
            .andExpect(jsonPath("$.items[0].previousDepartment").value("原部门"))
            .andExpect(jsonPath("$.items[0].previousLocation").value("总部"))
            .andExpect(jsonPath("$.items[0].assetOwnerCompany").value("资产所属公司"));

        mvc.perform(post("/api/assets/commands/handover-cancel").contentType(MediaType.APPLICATION_JSON).content("""
            {"assetIds":["PC-HANDOVER"],"fields":{"operationId":"%s","operator":"管理员","date":"2026-07-11"}}
            """.formatted(firstHandoverId)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.items[0].status").value("领用"))
            .andExpect(jsonPath("$.items[0].owner").value("原责任人"))
            .andExpect(jsonPath("$.items[0].ownerSubject").value("user-old"))
            .andExpect(jsonPath("$.items[0].handoverPreviousOwner").doesNotExist());

        mvc.perform(post("/api/assets/commands/handover").contentType(MediaType.APPLICATION_JSON).content("""
            {"assetIds":["PC-HANDOVER"],"fields":{"receiver":"新责任人","receiverSubject":"user-new",
              "location":"总部","handoverType":"员工交接","date":"2026-07-12"}}
            """))
            .andExpect(status().isOk());
        mvc.perform(post("/api/assets/commands/handover-sign").contentType(MediaType.APPLICATION_JSON).content("""
            {"assetIds":["PC-HANDOVER"],"fields":{"operatorSubject":"user-admin","date":"2026-07-13"}}
            """))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.error").value("Only the designated handover receiver can sign this asset"));
        mvc.perform(post("/api/assets/commands/handover-sign").contentType(MediaType.APPLICATION_JSON).content("""
            {"assetIds":["PC-HANDOVER"],"fields":{"operatorSubject":"user-new","date":"2026-07-13"}}
            """))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.items[0].status").value("领用"))
            .andExpect(jsonPath("$.items[0].owner").value("新责任人"))
            .andExpect(jsonPath("$.items[0].handoverPreviousOwner").doesNotExist());
    }

    @Test
    void handoverReceiverCanRejectOnlyTheirOwnPendingHandover() throws Exception {
        mvc.perform(post("/api/assets").contentType(MediaType.APPLICATION_JSON).content("""
            {"item":{"id":"PC-HANDOVER-REJECT","name":"交接资产","category":"电脑","location":"总部",
              "owner":"原责任人","ownerSubject":"user-old"}}
            """))
            .andExpect(status().isOk());
        mvc.perform(post("/api/assets/commands/handover").contentType(MediaType.APPLICATION_JSON).content("""
            {"assetIds":["PC-HANDOVER-REJECT"],"fields":{"receiver":"新责任人","receiverSubject":"user-new",
              "location":"总部","handoverType":"员工交接","date":"2026-07-10"}}
            """))
            .andExpect(status().isOk());
        String handoverId = operationId("PC-HANDOVER-REJECT", "HANDOVER");

        mvc.perform(post("/api/assets/commands/handover-reject").contentType(MediaType.APPLICATION_JSON).content("""
            {"assetIds":["PC-HANDOVER-REJECT"],"fields":{"operationId":"%s","operator":"其他员工",
              "operatorSubject":"user-other","reason":"非本人资产","date":"2026-07-11"}}
            """.formatted(handoverId)))
            .andExpect(status().isForbidden());

        mvc.perform(post("/api/assets/commands/handover-reject").contentType(MediaType.APPLICATION_JSON).content("""
            {"assetIds":["PC-HANDOVER-REJECT"],"fields":{"operationId":"%s","operator":"新责任人",
              "operatorSubject":"user-new","reason":"设备信息不符","date":"2026-07-11"}}
            """.formatted(handoverId)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.items[0].status").value("领用"))
            .andExpect(jsonPath("$.items[0].owner").value("原责任人"));

        Integer rejected = jdbc.queryForObject(
            "SELECT COUNT(*) FROM asset_operation_record WHERE operation_id = ? AND operation_status = ?",
            Integer.class, handoverId, "已打回");
        org.assertj.core.api.Assertions.assertThat(rejected).isEqualTo(1);
    }

    @Test
    void cancellingAStaleHandoverClosesOnlyTheOrderAndCatalogReplacementCannotCreateAnother() throws Exception {
        mvc.perform(post("/api/assets").contentType(MediaType.APPLICATION_JSON).content("""
            {"item":{"id":"PC-HANDOVER-STALE","name":"交接资产","category":"电脑","location":"总部",
              "owner":"原责任人","ownerSubject":"user-old"}}
            """))
            .andExpect(status().isOk());
        mvc.perform(post("/api/assets/commands/handover").contentType(MediaType.APPLICATION_JSON).content("""
            {"assetIds":["PC-HANDOVER-STALE"],"fields":{"receiver":"新责任人","receiverSubject":"user-new",
              "location":"总部","handoverType":"员工交接","date":"2026-07-10"}}
            """))
            .andExpect(status().isOk());

        mvc.perform(post("/api/assets/replace").contentType(MediaType.APPLICATION_JSON).content("""
            {"items":[{"id":"PC-HANDOVER-STALE","name":"交接资产","category":"电脑","location":"总部",
              "status":"空闲","owner":"未分配"}]}
            """))
            .andExpect(status().isBadRequest());

        String handoverId = operationId("PC-HANDOVER-STALE", "HANDOVER");
        String document = jdbc.queryForObject("SELECT document FROM asset_record WHERE asset_id = ?", String.class, "PC-HANDOVER-STALE");
        var staleAsset = (com.fasterxml.jackson.databind.node.ObjectNode) mapper.readTree(document);
        staleAsset.put("status", "空闲");
        staleAsset.put("owner", "未分配");
        staleAsset.put("ownerSubject", "");
        staleAsset.remove("handoverPreviousStatus");
        staleAsset.remove("handoverPreviousOwner");
        staleAsset.remove("handoverPreviousOwnerSubject");
        jdbc.update("UPDATE asset_record SET status = ?, document = ? WHERE asset_id = ?", "空闲", staleAsset.toString(), "PC-HANDOVER-STALE");

        mvc.perform(post("/api/assets/commands/handover-cancel").contentType(MediaType.APPLICATION_JSON).content("""
            {"assetIds":["PC-HANDOVER-STALE"],"fields":{"operationId":"%s","operator":"管理员","date":"2026-07-11"}}
            """.formatted(handoverId)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.items[0].status").value("空闲"))
            .andExpect(jsonPath("$.items[0].owner").value("未分配"));

        Integer cancelled = jdbc.queryForObject(
            "SELECT COUNT(*) FROM asset_operation_record WHERE operation_id = ? AND operation_status = ?",
            Integer.class, handoverId, "已取消");
        org.assertj.core.api.Assertions.assertThat(cancelled).isEqualTo(1);
    }

    private String operationId(String assetId, String type) {
        return jdbc.queryForObject("SELECT operation_id FROM asset_operation_record WHERE asset_id = ? AND operation_type = ? "
            + "ORDER BY created_at DESC, operation_id DESC LIMIT 1", String.class, assetId, type);
    }

    private int count(String table) {
        Integer value = jdbc.queryForObject("SELECT COUNT(*) FROM " + table, Integer.class);
        return value == null ? 0 : value;
    }

    @Test
    void receiveSignaturePersistsTheImageAndRejectRestoresTheAsset() throws Exception {
        var signSettings = mapper.createObjectNode();
        signSettings.set("assetReceive", mapper.createObjectNode().put("employeeSign", true)
            .put("noticeEnabled", true).put("noticeContent", "请核对资产"));
        signSettings.set("assetBorrow", mapper.createObjectNode().put("employeeSign", true));
        var settings = mapper.createObjectNode();
        settings.set("signSettings", signSettings);
        storeRepository.saveAll(Map.of("assetPortalSelfServiceSettingsV9", settings));

        mvc.perform(post("/api/assets").contentType(MediaType.APPLICATION_JSON).content("""
            {"item":{"id":"PC-SIGN","name":"签收资产","category":"电脑","location":"总部"}}
            """)).andExpect(status().isOk());

        mvc.perform(post("/api/assets/commands/receive").contentType(MediaType.APPLICATION_JSON).content("""
            {"assetIds":["PC-SIGN"],"fields":{"receiver":"李雷","receiverSubject":"user-1",
              "location":"总部","date":"2026-07-10"}}
            """))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.items[0].status").value("领用待签字"));

        mvc.perform(post("/api/assets/commands/receipt-sign").contentType(MediaType.APPLICATION_JSON).content("""
            {"assetIds":["PC-SIGN"],"fields":{"operator":"李雷","operatorSubject":"user-1",
              "signatureImage":"data:image/png;base64,AA==","date":"2026-07-11"}}
            """))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.items[0].status").value("领用"));

        mvc.perform(get("/api/asset-operations").param("type", "RECEIVE"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.items[0].status").value("已签字"))
            .andExpect(jsonPath("$.items[0].signatureImage").value("data:image/png;base64,AA=="))
            .andExpect(jsonPath("$.items[0].noticeContent").value("请核对资产"));

        mvc.perform(post("/api/assets").contentType(MediaType.APPLICATION_JSON).content("""
            {"item":{"id":"PC-REJECT","name":"打回资产","category":"电脑","location":"总部"}}
            """)).andExpect(status().isOk());
        mvc.perform(post("/api/assets/commands/borrow").contentType(MediaType.APPLICATION_JSON).content("""
            {"assetIds":["PC-REJECT"],"fields":{"borrower":"韩梅梅","borrowerSubject":"user-2",
              "location":"总部","date":"2026-07-10","expectedReturnDate":"2026-07-20"}}
            """))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.items[0].status").value("借用待签字"));
        mvc.perform(post("/api/assets/commands/receipt-reject").contentType(MediaType.APPLICATION_JSON).content("""
            {"assetIds":["PC-REJECT"],"fields":{"operator":"韩梅梅","operatorSubject":"user-2",
              "reason":"设备与单据不符","date":"2026-07-11"}}
            """))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.items[0].status").value("空闲"))
            .andExpect(jsonPath("$.items[0].owner").value("未分配"));
    }

    @Test
    void publicAreaHandoverCompletesWithoutAnImpossibleUserSignature() throws Exception {
        mvc.perform(post("/api/assets").contentType(MediaType.APPLICATION_JSON).content("""
            {"item":{"id":"PC-PUBLIC","name":"公共区域资产","category":"电脑","location":"总部",
              "owner":"原责任人","ownerSubject":"user-old"}}
            """))
            .andExpect(status().isOk());

        mvc.perform(post("/api/assets/commands/handover").contentType(MediaType.APPLICATION_JSON).content("""
            {"assetIds":["PC-PUBLIC"],"fields":{"receiver":"公共区域","receiverSubject":"asset:public-area",
              "location":"总部","handoverType":"公共交接","date":"2026-07-13"}}
            """))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.items[0].status").value("领用"))
            .andExpect(jsonPath("$.items[0].ownerSubject").value("asset:public-area"))
            .andExpect(jsonPath("$.items[0].handoverPreviousOwner").doesNotExist());
    }

    @Test
    void generatesUniqueCodesAndCopiesOnlyFromTheServerSource() throws Exception {
        mvc.perform(post("/api/assets").contentType(MediaType.APPLICATION_JSON).content("""
            {"item":{"name":"自动编码一","category":"电脑","location":"总部"}}
            """))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.item.id").value("PC00001"));
        mvc.perform(post("/api/assets/import").contentType(MediaType.APPLICATION_JSON).content("""
            {"items":[
              {"name":"自动编码二","category":"电脑","location":"总部"},
              {"name":"自动编码三","category":"电脑","location":"总部"}
            ]}
            """))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.items[0].id").value("PC00002"))
            .andExpect(jsonPath("$.items[1].id").value("PC00003"));

        mvc.perform(post("/api/assets").contentType(MediaType.APPLICATION_JSON).content("""
            {"sourceAssetId":"PC00001","item":{"id":"CLIENT-CONTROLLED","name":"服务端复制"}}
            """))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.item.id").value("PC00004"))
            .andExpect(jsonPath("$.item.name").value("服务端复制"))
            .andExpect(jsonPath("$.item.owner").value("未分配"));
    }

    @Test
    void cancelInboundRequiresAnAvailableUnassignedAsset() throws Exception {
        mvc.perform(post("/api/assets").contentType(MediaType.APPLICATION_JSON).content("""
            {"item":{"id":"PC-INBOUND-OK","name":"待取消入库资产","category":"电脑","location":"总部"}}
            """))
            .andExpect(status().isOk());
        mvc.perform(post("/api/assets/commands/cancel-inbound").contentType(MediaType.APPLICATION_JSON).content("""
            {"assetIds":["PC-INBOUND-OK"],"fields":{"operator":"管理员","date":"2026-07-13"}}
            """))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.items[0].inboundStatus").value("已取消"));

        mvc.perform(post("/api/assets").contentType(MediaType.APPLICATION_JSON).content("""
            {"item":{"id":"PC-INBOUND-ASSIGNED","name":"已分配资产","category":"电脑","location":"总部",
              "owner":"李雷","ownerSubject":"user-1"}}
            """))
            .andExpect(status().isOk());
        String document = jdbc.queryForObject(
            "SELECT document FROM asset_record WHERE asset_id = ?", String.class, "PC-INBOUND-ASSIGNED");
        var corrupted = (com.fasterxml.jackson.databind.node.ObjectNode) mapper.readTree(document);
        corrupted.put("status", "空闲");
        jdbc.update("UPDATE asset_record SET status = ?, document = ? WHERE asset_id = ?",
            "空闲", mapper.writeValueAsString(corrupted), "PC-INBOUND-ASSIGNED");

        mvc.perform(post("/api/assets/commands/cancel-inbound").contentType(MediaType.APPLICATION_JSON).content("""
            {"assetIds":["PC-INBOUND-ASSIGNED"],"fields":{"operator":"管理员","date":"2026-07-13"}}
            """))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("Only unassigned assets can have inbound cancelled: PC-INBOUND-ASSIGNED"));
    }

    @Test
    void importCommandsUsePerAssetOperationsAndAreAtomic() throws Exception {
        mvc.perform(post("/api/assets/import").contentType(MediaType.APPLICATION_JSON).content("""
            {"items":[
              {"id":"PC-IMPORT-1","name":"导入一","category":"电脑","location":"总部"},
              {"id":"PC-IMPORT-2","name":"导入二","category":"电脑","location":"总部"}
            ]}
            """))
            .andExpect(status().isOk());

        mvc.perform(post("/api/assets/commands/update-import").contentType(MediaType.APPLICATION_JSON).content("""
            {"assetIds":["PC-IMPORT-1","PC-IMPORT-2"],"fields":{"operations":{
              "PC-IMPORT-1":{"name":"更新一","date":"2026-07-13"},
              "PC-IMPORT-2":{"name":"更新二","date":"2026-07-13"}
            }}}
            """))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.items[?(@.id == 'PC-IMPORT-1')].name").value("更新一"))
            .andExpect(jsonPath("$.items[?(@.id == 'PC-IMPORT-2')].name").value("更新二"));

        mvc.perform(post("/api/assets/commands/update-import").contentType(MediaType.APPLICATION_JSON).content("""
            {"assetIds":["PC-IMPORT-1","PC-IMPORT-2"],"fields":{"operations":{
              "PC-IMPORT-1":{"name":"不应写入"},
              "PC-EXTRA":{"name":"多余记录"}
            }}}
            """))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value(org.hamcrest.Matchers.containsString("must exactly match asset ids")));

        mvc.perform(post("/api/assets/commands/receive-import").contentType(MediaType.APPLICATION_JSON).content("""
            {"assetIds":["PC-IMPORT-1","PC-IMPORT-2"],"fields":{"operations":{
              "PC-IMPORT-1":{"receiver":"李雷","receiverSubject":"user-1","location":"总部","date":"2026-07-13"},
              "PC-IMPORT-2":{"receiver":"韩梅梅","receiverSubject":"user-2","location":"不存在","date":"2026-07-13"}
            }}}
            """))
            .andExpect(status().isBadRequest());

        mvc.perform(get("/api/assets"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.items[?(@.id == 'PC-IMPORT-1')].status").value("空闲"))
            .andExpect(jsonPath("$.items[?(@.id == 'PC-IMPORT-2')].status").value("空闲"));

        mvc.perform(post("/api/assets/commands/receive-import").contentType(MediaType.APPLICATION_JSON).content("""
            {"assetIds":["PC-IMPORT-1","PC-IMPORT-2"],"fields":{"operations":{
              "PC-IMPORT-1":{"receiver":"李雷","receiverSubject":"user-1","location":"总部","date":"2026-07-13"},
              "PC-IMPORT-2":{"receiver":"韩梅梅","receiverSubject":"user-2","location":"总部","date":"2026-07-13"}
            }}}
            """))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.items[?(@.id == 'PC-IMPORT-1')].ownerSubject").value("user-1"))
            .andExpect(jsonPath("$.items[?(@.id == 'PC-IMPORT-2')].ownerSubject").value("user-2"));
    }
}
