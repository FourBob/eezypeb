/*
 * eezy.nrw für Pebble – Watch-Seite.
 *
 * Die Uhr hat kein Netz. Sie zeigt ein Menü (Check-in / Check-out / Ticket /
 * Status), schickt den gewählten Befehl per AppMessage an den JS-Teil auf dem
 * Handy (src/pkjs) und bekommt Text (STATUS), Zustand (CHECKED_IN) und bei
 * aktivem Ticket den Barcode als gepackte Bitmatrix (BC_*) zurück.
 */
#include <pebble.h>

enum Command {
  CMD_CHECKIN = 1,
  CMD_CHECKOUT = 2,
  CMD_TICKET = 3,
  CMD_STATUS = 4,
};

#define STATUS_BAR_HEIGHT 36
#define RESPONSE_TIMEOUT_MS 25000
#define BARCODE_MAX_MODULES 151      /* größter Aztec-Code */
#define INBOX_SIZE 1024
#define OUTBOX_SIZE 64

static Window *s_window;
static TextLayer *s_status_layer;
static MenuLayer *s_menu_layer;
static AppTimer *s_timeout_timer;

static Window *s_barcode_window;
static Layer *s_barcode_layer;

static char s_status[96] = "Bereit";
static bool s_checked_in = false;
static bool s_busy = false;

/* Barcode: quadratische Matrix, zeilenweise gepackt, MSB zuerst, 1 = schwarz. */
static uint8_t *s_bc_bits;
static uint16_t s_bc_size;          /* Module pro Seite */
static uint16_t s_bc_stride;        /* Bytes pro Zeile */
static uint16_t s_bc_received;      /* bisher empfangene Bytes */
static bool s_bc_complete = false;

/* ------------------------------------------------------------------ */
/* Status                                                              */
/* ------------------------------------------------------------------ */

static void set_status(const char *text) {
  strncpy(s_status, text, sizeof(s_status) - 1);
  s_status[sizeof(s_status) - 1] = '\0';
  text_layer_set_text(s_status_layer, s_status);
  menu_layer_reload_data(s_menu_layer);
}

static void set_busy(bool busy) {
  s_busy = busy;
  if (s_timeout_timer) {
    app_timer_cancel(s_timeout_timer);
    s_timeout_timer = NULL;
  }
}

static void timeout_handler(void *context) {
  s_timeout_timer = NULL;
  if (s_busy) {
    set_busy(false);
    set_status("Keine Antwort vom Handy");
    vibes_double_pulse();
  }
}

/* ------------------------------------------------------------------ */
/* Barcode-Fenster                                                     */
/* ------------------------------------------------------------------ */

static void barcode_reset(void) {
  free(s_bc_bits);
  s_bc_bits = NULL;
  s_bc_size = 0;
  s_bc_stride = 0;
  s_bc_received = 0;
  s_bc_complete = false;
}

static bool barcode_begin(uint16_t size) {
  barcode_reset();
  if (size == 0 || size > BARCODE_MAX_MODULES) {
    APP_LOG(APP_LOG_LEVEL_ERROR, "Ungültige Barcodegröße %u", (unsigned)size);
    return false;
  }
  s_bc_size = size;
  s_bc_stride = (size + 7) / 8;
  s_bc_bits = calloc(s_bc_stride * size, 1);
  if (!s_bc_bits) {
    APP_LOG(APP_LOG_LEVEL_ERROR, "Kein Speicher für Barcode");
    return false;
  }
  return true;
}

static void barcode_append(uint16_t offset, const uint8_t *data, uint16_t length) {
  if (!s_bc_bits) { return; }
  uint32_t total = (uint32_t)s_bc_stride * s_bc_size;
  if (offset >= total) { return; }
  if (offset + length > total) { length = total - offset; }
  memcpy(s_bc_bits + offset, data, length);
  s_bc_received = offset + length;
}

static bool barcode_module(uint16_t x, uint16_t y) {
  return (s_bc_bits[y * s_bc_stride + (x >> 3)] >> (7 - (x & 7))) & 1;
}

static void barcode_layer_update(Layer *layer, GContext *ctx) {
  GRect bounds = layer_get_bounds(layer);
  graphics_context_set_fill_color(ctx, GColorWhite);
  graphics_fill_rect(ctx, bounds, 0, GCornerNone);

  if (!s_bc_complete || !s_bc_bits) {
    return;
  }

  /* Ruhezone von 2 Modulen, ganzzahliger Skalierungsfaktor, zentriert. */
  uint16_t total = s_bc_size + 4;
  int16_t avail = bounds.size.w < bounds.size.h ? bounds.size.w : bounds.size.h;
  int16_t scale = avail / total;
  if (scale < 1) { scale = 1; }
  int16_t px = s_bc_size * scale;
  int16_t x0 = (bounds.size.w - px) / 2;
  int16_t y0 = (bounds.size.h - px) / 2;

  graphics_context_set_fill_color(ctx, GColorBlack);
  for (uint16_t y = 0; y < s_bc_size; y++) {
    for (uint16_t x = 0; x < s_bc_size; x++) {
      if (barcode_module(x, y)) {
        graphics_fill_rect(ctx, GRect(x0 + x * scale, y0 + y * scale, scale, scale), 0, GCornerNone);
      }
    }
  }
}

static void barcode_window_load(Window *window) {
  Layer *root = window_get_root_layer(window);
  s_barcode_layer = layer_create(layer_get_bounds(root));
  layer_set_update_proc(s_barcode_layer, barcode_layer_update);
  layer_add_child(root, s_barcode_layer);
  light_enable(true);
}

static void barcode_window_unload(Window *window) {
  light_enable(false);
  layer_destroy(s_barcode_layer);
  s_barcode_layer = NULL;
}

static void show_barcode(void) {
  if (!s_barcode_window) {
    s_barcode_window = window_create();
    window_set_background_color(s_barcode_window, GColorWhite);
    window_set_window_handlers(s_barcode_window, (WindowHandlers) {
      .load = barcode_window_load,
      .unload = barcode_window_unload,
    });
  }
  if (!window_stack_contains_window(s_barcode_window)) {
    window_stack_push(s_barcode_window, true);
  } else if (s_barcode_layer) {
    layer_mark_dirty(s_barcode_layer);
  }
}

/* ------------------------------------------------------------------ */
/* AppMessage                                                          */
/* ------------------------------------------------------------------ */

static void send_command(enum Command cmd) {
  if (s_busy) {
    return;
  }

  DictionaryIterator *iter;
  AppMessageResult result = app_message_outbox_begin(&iter);
  if (result != APP_MSG_OK) {
    APP_LOG(APP_LOG_LEVEL_ERROR, "outbox_begin fehlgeschlagen: %d", (int)result);
    set_status("Handy nicht erreichbar");
    return;
  }

  dict_write_int32(iter, MESSAGE_KEY_CMD, (int32_t)cmd);
  dict_write_end(iter);

  result = app_message_outbox_send();
  if (result != APP_MSG_OK) {
    APP_LOG(APP_LOG_LEVEL_ERROR, "outbox_send fehlgeschlagen: %d", (int)result);
    set_status("Senden fehlgeschlagen");
    return;
  }

  set_busy(true);
  s_timeout_timer = app_timer_register(RESPONSE_TIMEOUT_MS, timeout_handler, NULL);

  switch (cmd) {
    case CMD_CHECKIN:  set_status("Check-in ..."); break;
    case CMD_CHECKOUT: set_status("Check-out ..."); break;
    case CMD_TICKET:   set_status("Hole Ticket ..."); break;
    default:           set_status("Frage Status ab ..."); break;
  }
}

static void inbox_received_handler(DictionaryIterator *iter, void *context) {
  Tuple *t;

  if ((t = dict_find(iter, MESSAGE_KEY_CHECKED_IN))) {
    s_checked_in = t->value->int32 != 0;
    if (!s_checked_in) {
      barcode_reset();
    }
  }

  /* Barcode-Übertragung: BC_SIZE startet, BC_DATA+BC_OFFSET liefern Stücke,
   * BC_DONE schließt ab und öffnet die Anzeige. */
  if ((t = dict_find(iter, MESSAGE_KEY_BC_SIZE))) {
    barcode_begin((uint16_t)t->value->int32);
  }
  Tuple *data = dict_find(iter, MESSAGE_KEY_BC_DATA);
  Tuple *offset = dict_find(iter, MESSAGE_KEY_BC_OFFSET);
  if (data && offset) {
    barcode_append((uint16_t)offset->value->int32, data->value->data, data->length);
  }
  if ((t = dict_find(iter, MESSAGE_KEY_BC_DONE))) {
    s_bc_complete = s_bc_bits && s_bc_received >= (uint32_t)s_bc_stride * s_bc_size;
    if (s_bc_complete) {
      show_barcode();
    } else {
      APP_LOG(APP_LOG_LEVEL_ERROR, "Barcode unvollständig: %u Bytes", (unsigned)s_bc_received);
    }
  }

  if ((t = dict_find(iter, MESSAGE_KEY_STATUS))) {
    set_busy(false);
    set_status(t->value->cstring);
    vibes_short_pulse();
  } else {
    menu_layer_reload_data(s_menu_layer);
  }
}

static void inbox_dropped_handler(AppMessageResult reason, void *context) {
  APP_LOG(APP_LOG_LEVEL_WARNING, "Nachricht verworfen: %d", (int)reason);
}

static void outbox_failed_handler(DictionaryIterator *iter, AppMessageResult reason, void *context) {
  APP_LOG(APP_LOG_LEVEL_ERROR, "Senden fehlgeschlagen: %d", (int)reason);
  set_busy(false);
  set_status("Senden fehlgeschlagen");
}

/* ------------------------------------------------------------------ */
/* Menü                                                                */
/* ------------------------------------------------------------------ */

enum MenuRow {
  ROW_CHECKIN = 0,
  ROW_CHECKOUT,
  ROW_TICKET,
  ROW_STATUS,
  ROW_COUNT,
};

static uint16_t menu_get_num_rows(MenuLayer *menu_layer, uint16_t section_index, void *context) {
  return ROW_COUNT;
}

static void menu_draw_row(GContext *ctx, const Layer *cell_layer, MenuIndex *cell_index, void *context) {
  switch (cell_index->row) {
    case ROW_CHECKIN:
      menu_cell_basic_draw(ctx, cell_layer, "Check-in",
                           s_checked_in ? "Fahrt läuft bereits" : "Fahrt beginnen", NULL);
      break;
    case ROW_CHECKOUT:
      menu_cell_basic_draw(ctx, cell_layer, "Check-out",
                           s_checked_in ? "Fahrt beenden" : "keine aktive Fahrt", NULL);
      break;
    case ROW_TICKET:
      menu_cell_basic_draw(ctx, cell_layer, "Ticket",
                           s_bc_complete ? "Barcode anzeigen" : "Barcode laden", NULL);
      break;
    case ROW_STATUS:
      menu_cell_basic_draw(ctx, cell_layer, "Status",
                           s_checked_in ? "eingecheckt" : "ausgecheckt", NULL);
      break;
  }
}

static void menu_select_click(MenuLayer *menu_layer, MenuIndex *cell_index, void *context) {
  switch (cell_index->row) {
    case ROW_CHECKIN:  send_command(CMD_CHECKIN);  break;
    case ROW_CHECKOUT: send_command(CMD_CHECKOUT); break;
    case ROW_TICKET:
      if (s_bc_complete) {
        show_barcode();
      } else {
        send_command(CMD_TICKET);
      }
      break;
    case ROW_STATUS:   send_command(CMD_STATUS);   break;
  }
}

/* ------------------------------------------------------------------ */
/* Hauptfenster                                                        */
/* ------------------------------------------------------------------ */

static void window_load(Window *window) {
  Layer *window_layer = window_get_root_layer(window);
  GRect bounds = layer_get_bounds(window_layer);

  s_status_layer = text_layer_create(GRect(0, 0, bounds.size.w, STATUS_BAR_HEIGHT));
  text_layer_set_font(s_status_layer, fonts_get_system_font(FONT_KEY_GOTHIC_18));
  text_layer_set_text_alignment(s_status_layer, GTextAlignmentCenter);
  text_layer_set_overflow_mode(s_status_layer, GTextOverflowModeTrailingEllipsis);
  text_layer_set_background_color(s_status_layer, GColorBlack);
  text_layer_set_text_color(s_status_layer, GColorWhite);
  text_layer_set_text(s_status_layer, s_status);
  layer_add_child(window_layer, text_layer_get_layer(s_status_layer));

  GRect menu_bounds = GRect(0, STATUS_BAR_HEIGHT, bounds.size.w, bounds.size.h - STATUS_BAR_HEIGHT);
  s_menu_layer = menu_layer_create(menu_bounds);
  menu_layer_set_callbacks(s_menu_layer, NULL, (MenuLayerCallbacks) {
    .get_num_rows = menu_get_num_rows,
    .draw_row = menu_draw_row,
    .select_click = menu_select_click,
  });
  menu_layer_set_click_config_onto_window(s_menu_layer, window);
  layer_add_child(window_layer, menu_layer_get_layer(s_menu_layer));
}

static void window_unload(Window *window) {
  menu_layer_destroy(s_menu_layer);
  text_layer_destroy(s_status_layer);
}

static void init(void) {
  s_window = window_create();
  window_set_window_handlers(s_window, (WindowHandlers) {
    .load = window_load,
    .unload = window_unload,
  });

  app_message_register_inbox_received(inbox_received_handler);
  app_message_register_inbox_dropped(inbox_dropped_handler);
  app_message_register_outbox_failed(outbox_failed_handler);
  app_message_open(INBOX_SIZE, OUTBOX_SIZE);

  window_stack_push(s_window, true);
}

static void deinit(void) {
  if (s_timeout_timer) {
    app_timer_cancel(s_timeout_timer);
  }
  barcode_reset();
  if (s_barcode_window) {
    window_destroy(s_barcode_window);
  }
  window_destroy(s_window);
}

int main(void) {
  init();
  app_event_loop();
  deinit();
}
