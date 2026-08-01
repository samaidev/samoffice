src = "/root/lal/tools/train_scratch.c"
out = "/root/lal/tools/train_scratch_semantic.c"
s = open(src).read()

a = '#include "../runtime/lal_bpe.h"\n'
assert a in s, "inc anchor"
s = s.replace(a, a +
'#include <stdint.h>\n#include <stdlib.h>\n'
'#define LAL_SEMANTIC_GATE_IMPLEMENTATION\n'
'#include "../runtime/lal_semantic_logic.h"\n'
'#include "../runtime/lal_semantic_gate.h"\n', 1)

m = "int main(int argc, char **argv) {"
g = r'''/* semantic monitoring: break the black box via gate + logic mask */
static Model *g_model = NULL;
static LalBPE *g_bp = NULL;

static const LogicRatios g_phases[4] = {
    {0.10f, 0.50f, 0.40f, "phase0"},
    {0.15f, 0.60f, 0.25f, "phase1"},
    {0.18f, 0.67f, 0.15f, "phase2"},
    {0.20f, 0.70f, 0.10f, "phase3"},
};

static void apply_logic_mask(Model *m_, int phase) {
    if (phase < 0) phase = 0;
    if (phase > 3) phase = 3;
    LogicRatios ratios = g_phases[phase];
    printf("[*] semantic logic mask phase %d: CORE=%.0f%% BINARY=%.0f%% PRUNE=%.0f%%\n",
           phase, ratios.core_ratio*100.0f, ratios.binary_ratio*100.0f, ratios.prune_ratio*100.0f);
    for (int l = 0; l < m_->cfg.n_layer; l++) {
        TransLayer *tl = &m_->layers[l];
        BinLayer *bls[6] = { &tl->attn_q, &tl->attn_k, &tl->attn_v,
                             &tl->attn_o, &tl->mlp_gate, &tl->mlp_down };
        for (int b = 0; b < 6; b++) {
            BinLayer *bl = bls[b];
            if (bl->out_dim <= 0 || bl->in_dim <= 0 || !bl->w_float) continue;
            uint8_t *mask = (uint8_t*)calloc(bl->out_dim, 1);
            compute_semantic_mask(bl->w_float, bl->in_dim, bl->out_dim, mask, &ratios);
            bin_layer_init_logic(bl, bl->w_float, bl->bias, bl->in_dim, bl->out_dim, mask);
            free(mask);
        }
        if (m_->cfg.act_type == ACT_SWIGLU && tl->mlp_up.out_dim > 0 && tl->mlp_up.w_float) {
            BinLayer *bl = &tl->mlp_up;
            uint8_t *mask = (uint8_t*)calloc(bl->out_dim, 1);
            compute_semantic_mask(bl->w_float, bl->in_dim, bl->out_dim, mask, &ratios);
            bin_layer_init_logic(bl, bl->w_float, bl->bias, bl->in_dim, bl->out_dim, mask);
            free(mask);
        }
    }
}

static uint32_t xs_state = 0x9e3779b9u;
static uint32_t xs_next(void) {
    uint32_t x = xs_state;
    x ^= x << 13; x ^= x >> 17; x ^= x << 5;
    xs_state = x;
    return x;
}

static void semantic_generate(const char *prompt, char *output, int max_out) {
    Model *m = g_model;
    LalBPE *bp = g_bp;
    if (!m) { output[0] = '\0'; return; }
    int V = m->cfg.vocab_size;
    int cap = 96;
    int *ids = (int*)malloc(sizeof(int) * cap);
    int n = 0;
    if (bp) n = lal_bpe_encode(bp, prompt, (int)strlen(prompt), ids, cap);
    if (n <= 0) { int pl = (int)strlen(prompt); for (int i=0;i<pl && n<cap;i++) ids[n++]=(unsigned char)prompt[i]; }
    if (n <= 0) n = 1;
    float *logits = (float*)malloc(sizeof(float) * V);
    int cur = n, maxgen = 56;
    while (cur < cap && maxgen-- > 0) {
        model_forward_float_logits(m, ids, cur, logits);
        float mx = logits[0];
        for (int i = 1; i < V; i++) if (logits[i] > mx) mx = logits[i];
        double sum = 0;
        for (int i = 0; i < V; i++) { logits[i] = expf((logits[i]-mx)/0.85f); sum += logits[i]; }
        double r = ((double)xs_next()/4294967296.0)*sum, acc = 0;
        int pick = V-1;
        for (int i = 0; i < V; i++) { acc += logits[i]; if (acc >= r) { pick = i; break; } }
        ids[cur++] = pick;
        if (bp && pick == bp->eos_id) break;
    }
    if (bp) lal_bpe_decode(bp, ids, cur, output, max_out);
    else { int w=0; for (int i=0;i<cur && w+1<max_out;i++) output[w++]=(char)ids[i]; output[w]='\0'; }
    free(ids); free(logits);
}

'''
assert m in s, "main anchor"
s = s.replace(m, g + m, 1)

f = "    for (int i = 1; i < argc; i++) {"
assert f in s, "forloop anchor"
s = s.replace(f, "    int sem_every = 0, phase_step = 0, start_phase = 0;\n" + f, 1)

ar = '        else { fprintf(stderr, "[!] unknown arg: %s\\n", argv[i]); return 1; }'
assert ar in s, "arg anchor"
s = s.replace(ar,
'        else if (!strcmp(argv[i], "--semantic-eval-every") && i+1 < argc) sem_every = atoi(argv[++i]);\n'
'        else if (!strcmp(argv[i], "--phase-step") && i+1 < argc) phase_step = atoi(argv[++i]);\n'
'        else if (!strcmp(argv[i], "--start-phase") && i+1 < argc) start_phase = atoi(argv[++i]);\n' + ar, 1)

lo = '    model_load(&model, weights, cfg, "h.%d.", cfg.qkv_merged);'
assert lo in s, "load anchor"
s = s.replace(lo, lo +
'\n    g_model = &model; g_bp = have_bp ? &bp : NULL;\n'
'    if (start_phase < 0) start_phase = 0;\n'
'    if (start_phase > 3) start_phase = 3;\n'
'    apply_logic_mask(&model, start_phase);\n'
'    int cur_phase = start_phase;\n', 1)

cl = '    }\n\n    clock_gettime(CLOCK_MONOTONIC, &t1);'
gb = (
'    /* ---- semantic gate eval (break-the-black-box monitoring) ---- */\n'
'    if (sem_every > 0 && (step + 1) % sem_every == 0) {\n'
'        int gi = (cur_phase < 4) ? cur_phase : 3;\n'
'        GateThreshold th = gate_thresholds[gi];\n'
'        th.required_level = (cur_phase + 2 > 4) ? 4 : cur_phase + 2;\n'
'        SemanticEval ev;\n'
'        int gl = run_semantic_gate(semantic_generate, &th, &ev, 6);\n'
'        printf("      [semantic] level=L%d gate=%d concept=%.3f relation=%.3f commonsense=%.3f | %s\\n",\n'
'               ev.level, ev.passed, ev.concept_score, ev.relation_score, ev.commonsense_score, ev.diagnosis);\n'
'        if (ev.level < th.required_level && (step + 1) > sem_every * 4 && cur_phase < 3) {\n'
'            cur_phase++; apply_logic_mask(&model, cur_phase);\n'
'            printf("      [grow] gate stalled -> advanced to semantic phase %d\\n", cur_phase);\n'
'        }\n'
'    }\n'
'    if (phase_step > 0 && (step + 1) % phase_step == 0 && cur_phase < 3) {\n'
'        cur_phase++; apply_logic_mask(&model, cur_phase);\n'
'        printf("      [grow] scheduled advance to semantic phase %d\\n", cur_phase);\n'
'    }\n'
'    }\n\n    clock_gettime(CLOCK_MONOTONIC, &t1);'
)
assert cl in s, "clock anchor"
s = s.replace(cl, gb, 1)

open(out, "w").write(s)
print("OK wrote", out, len(s))
