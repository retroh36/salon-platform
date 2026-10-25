
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "ai_actions": {
                  Row: {
                    "business_id": string,"created_at": string,"decided_at": string | null,"decided_by": string | null,"feature": string,"id": string,"location_id": string,"previous_state": Json | null,"proposal": NonNullable<Json>,"proposed_by": string | null,"rank": number,"reason": string,"status": Database["public"]['Enums']["ai_action_status"],"subject": string | null,"summary": string,"undone_at": string | null,"undone_by": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"created_at"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"feature": string,"id"?: string,"location_id": string,"previous_state"?: Json | null,"proposal": NonNullable<Json>,"proposed_by"?: string | null,"rank"?: number,"reason": string,"status"?: Database["public"]['Enums']["ai_action_status"],"subject"?: string | null,"summary": string,"undone_at"?: string | null,"undone_by"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "business_id"?: string,"created_at"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"feature"?: string,"id"?: string,"location_id"?: string,"previous_state"?: Json | null,"proposal"?: NonNullable<Json>,"proposed_by"?: string | null,"rank"?: number,"reason"?: string,"status"?: Database["public"]['Enums']["ai_action_status"],"subject"?: string | null,"summary"?: string,"undone_at"?: string | null,"undone_by"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ai_actions_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ai_actions_decided_by_business_id_fkey"
      columns: ["decided_by","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "ai_actions_location_id_business_id_fkey"
      columns: ["location_id","business_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "ai_actions_proposed_by_business_id_fkey"
      columns: ["proposed_by","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "ai_actions_undone_by_business_id_fkey"
      columns: ["undone_by","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"ai_usage": {
                  Row: {
                    "business_id": string,"cache_read_tokens": number,"day": string,"feature": string,"input_tokens": number,"model": string,"output_tokens": number,"requests": number
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"cache_read_tokens"?: number,"day": string,"feature": string,"input_tokens"?: number,"model": string,"output_tokens"?: number,"requests"?: number
                  }
                  Update: {
                    "business_id"?: string,"cache_read_tokens"?: number,"day"?: string,"feature"?: string,"input_tokens"?: number,"model"?: string,"output_tokens"?: number,"requests"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "ai_usage_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    }
                  ]
                },"appointment_events": {
                  Row: {
                    "appointment_id": string,"business_id": string,"created_at": string,"detail": NonNullable<Json>,"id": string,"kind": string,"staff_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "appointment_id": string,"business_id": string,"created_at"?: string,"detail"?: NonNullable<Json>,"id"?: string,"kind": string,"staff_id"?: string | null
                  }
                  Update: {
                    "appointment_id"?: string,"business_id"?: string,"created_at"?: string,"detail"?: NonNullable<Json>,"id"?: string,"kind"?: string,"staff_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "appointment_events_appointment_id_fkey"
      columns: ["appointment_id"]
isOneToOne: false
      referencedRelation: "appointments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "appointment_events_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "appointment_events_staff_id_business_id_fkey"
      columns: ["staff_id","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"appointment_groups": {
                  Row: {
                    "business_id": string,"created_at": string,"created_by": string | null,"id": string,"label": string,"location_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"label": string,"location_id": string
                  }
                  Update: {
                    "business_id"?: string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"label"?: string,"location_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "appointment_groups_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "appointment_groups_created_by_business_id_fkey"
      columns: ["created_by","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "appointment_groups_location_id_business_id_fkey"
      columns: ["location_id","business_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"appointment_items": {
                  Row: {
                    "active_minutes": number,"appointment_id": string,"business_id": string,"created_at": string,"ends_at": string,"finished_at": string | null,"finishing_minutes": number,"holds_time": boolean,"id": string,"imported": boolean,"location_id": string,"price_cents": number,"processing_ended_at": string | null,"processing_minutes": number,"processing_started_at": string | null,"resource_held": unknown,"resource_id": string | null,"service_id": string,"staff_busy": unknown,"staff_id": string,"started_at": string | null,"starts_at": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "active_minutes": number,"appointment_id": string,"business_id": string,"created_at"?: string,"ends_at": string,"finished_at"?: string | null,"finishing_minutes"?: number,"holds_time"?: boolean,"id"?: string,"imported"?: boolean,"location_id": string,"price_cents": number,"processing_ended_at"?: string | null,"processing_minutes"?: number,"processing_started_at"?: string | null,"resource_held"?: never,"resource_id"?: string | null,"service_id": string,"staff_busy"?: never,"staff_id": string,"started_at"?: string | null,"starts_at": string,"updated_at"?: string
                  }
                  Update: {
                    "active_minutes"?: number,"appointment_id"?: string,"business_id"?: string,"created_at"?: string,"ends_at"?: string,"finished_at"?: string | null,"finishing_minutes"?: number,"holds_time"?: boolean,"id"?: string,"imported"?: boolean,"location_id"?: string,"price_cents"?: number,"processing_ended_at"?: string | null,"processing_minutes"?: number,"processing_started_at"?: string | null,"resource_held"?: never,"resource_id"?: string | null,"service_id"?: string,"staff_busy"?: never,"staff_id"?: string,"started_at"?: string | null,"starts_at"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "appointment_items_appointment_id_business_id_location_id_fkey"
      columns: ["appointment_id","business_id","location_id"]
isOneToOne: false
      referencedRelation: "appointments"
      referencedColumns: ["id","business_id","location_id"]
    },{
      foreignKeyName: "appointment_items_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "appointment_items_resource_id_location_id_fkey"
      columns: ["resource_id","location_id"]
isOneToOne: false
      referencedRelation: "resources"
      referencedColumns: ["id","location_id"]
    },{
      foreignKeyName: "appointment_items_service_id_business_id_fkey"
      columns: ["service_id","business_id"]
isOneToOne: false
      referencedRelation: "services"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "appointment_items_staff_id_business_id_fkey"
      columns: ["staff_id","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"appointment_series": {
                  Row: {
                    "business_id": string,"client_id": string | null,"created_at": string,"created_by": string | null,"ends_on": string | null,"id": string,"interval_weeks": number,"location_id": string,"occurrences": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"client_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"ends_on"?: string | null,"id"?: string,"interval_weeks": number,"location_id": string,"occurrences"?: number | null
                  }
                  Update: {
                    "business_id"?: string,"client_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"ends_on"?: string | null,"id"?: string,"interval_weeks"?: number,"location_id"?: string,"occurrences"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "appointment_series_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "appointment_series_client_id_business_id_fkey"
      columns: ["client_id","business_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "appointment_series_created_by_business_id_fkey"
      columns: ["created_by","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "appointment_series_location_id_business_id_fkey"
      columns: ["location_id","business_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"appointments": {
                  Row: {
                    "business_id": string,"cancel_reason": string | null,"canceled_at": string | null,"checked_in_at": string | null,"checked_out_at": string | null,"client_id": string | null,"created_at": string,"created_by": string | null,"deposit_cents": number,"deposit_outcome": string | null,"deposit_paid_cents": number,"deposit_provider": string | null,"deposit_reference": string | null,"ends_at": string,"event_id": string | null,"group_id": string | null,"id": string,"location_id": string,"manage_token_hash": string | null,"notes": string | null,"online_source": string | null,"promotion_id": string | null,"series_id": string | null,"series_index": number | null,"source": Database["public"]['Enums']["appointment_source"],"starts_at": string,"status": Database["public"]['Enums']["appointment_status"],"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"cancel_reason"?: string | null,"canceled_at"?: string | null,"checked_in_at"?: string | null,"checked_out_at"?: string | null,"client_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"deposit_cents"?: number,"deposit_outcome"?: string | null,"deposit_paid_cents"?: number,"deposit_provider"?: string | null,"deposit_reference"?: string | null,"ends_at": string,"event_id"?: string | null,"group_id"?: string | null,"id"?: string,"location_id": string,"manage_token_hash"?: string | null,"notes"?: string | null,"online_source"?: string | null,"promotion_id"?: string | null,"series_id"?: string | null,"series_index"?: number | null,"source"?: Database["public"]['Enums']["appointment_source"],"starts_at": string,"status"?: Database["public"]['Enums']["appointment_status"],"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "business_id"?: string,"cancel_reason"?: string | null,"canceled_at"?: string | null,"checked_in_at"?: string | null,"checked_out_at"?: string | null,"client_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"deposit_cents"?: number,"deposit_outcome"?: string | null,"deposit_paid_cents"?: number,"deposit_provider"?: string | null,"deposit_reference"?: string | null,"ends_at"?: string,"event_id"?: string | null,"group_id"?: string | null,"id"?: string,"location_id"?: string,"manage_token_hash"?: string | null,"notes"?: string | null,"online_source"?: string | null,"promotion_id"?: string | null,"series_id"?: string | null,"series_index"?: number | null,"source"?: Database["public"]['Enums']["appointment_source"],"starts_at"?: string,"status"?: Database["public"]['Enums']["appointment_status"],"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "appointments_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "appointments_client_id_business_id_fkey"
      columns: ["client_id","business_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "appointments_created_by_business_id_fkey"
      columns: ["created_by","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "appointments_event_fk"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "appointments_group_id_business_id_fkey"
      columns: ["group_id","business_id"]
isOneToOne: false
      referencedRelation: "appointment_groups"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "appointments_location_id_business_id_fkey"
      columns: ["location_id","business_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "appointments_promotion_id_fkey"
      columns: ["promotion_id"]
isOneToOne: false
      referencedRelation: "promotions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "appointments_series_id_business_id_fkey"
      columns: ["series_id","business_id"]
isOneToOne: false
      referencedRelation: "appointment_series"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "appointments_updated_by_business_id_fkey"
      columns: ["updated_by","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"businesses": {
                  Row: {
                    "ai_daily_token_limit": number,"auto_lock_minutes": number,"cash_float_cents": number,"created_at": string,"discount_max_percent": number,"discount_roles": (Database["public"]['Enums']["staff_role"])[],"free_text_roles": (Database["public"]['Enums']["staff_role"])[],"gift_card_expiry_months": number | null,"gift_card_presets_cents": (number)[],"google_review_url": string | null,"id": string,"logo_path": string | null,"name": string,"next_sale_number": number,"patch_test_enforcement": string,"patch_test_min_hours": number,"patch_test_valid_days": number,"pay_period": string,"pay_period_anchor": string,"plan": string,"promo_card_expiry_days": number,"receipt_footer": string | null,"receipt_show_stylists": boolean,"settings": NonNullable<Json>,"slug": string | null,"tax_rate_retail_bp": number,"tax_rate_services_bp": number,"updated_at": string,"yelp_url": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "ai_daily_token_limit"?: number,"auto_lock_minutes"?: number,"cash_float_cents"?: number,"created_at"?: string,"discount_max_percent"?: number,"discount_roles"?: (Database["public"]['Enums']["staff_role"])[],"free_text_roles"?: (Database["public"]['Enums']["staff_role"])[],"gift_card_expiry_months"?: number | null,"gift_card_presets_cents"?: (number)[],"google_review_url"?: string | null,"id"?: string,"logo_path"?: string | null,"name": string,"next_sale_number"?: number,"patch_test_enforcement"?: string,"patch_test_min_hours"?: number,"patch_test_valid_days"?: number,"pay_period"?: string,"pay_period_anchor"?: string,"plan"?: string,"promo_card_expiry_days"?: number,"receipt_footer"?: string | null,"receipt_show_stylists"?: boolean,"settings"?: NonNullable<Json>,"slug"?: string | null,"tax_rate_retail_bp"?: number,"tax_rate_services_bp"?: number,"updated_at"?: string,"yelp_url"?: string | null
                  }
                  Update: {
                    "ai_daily_token_limit"?: number,"auto_lock_minutes"?: number,"cash_float_cents"?: number,"created_at"?: string,"discount_max_percent"?: number,"discount_roles"?: (Database["public"]['Enums']["staff_role"])[],"free_text_roles"?: (Database["public"]['Enums']["staff_role"])[],"gift_card_expiry_months"?: number | null,"gift_card_presets_cents"?: (number)[],"google_review_url"?: string | null,"id"?: string,"logo_path"?: string | null,"name"?: string,"next_sale_number"?: number,"patch_test_enforcement"?: string,"patch_test_min_hours"?: number,"patch_test_valid_days"?: number,"pay_period"?: string,"pay_period_anchor"?: string,"plan"?: string,"promo_card_expiry_days"?: number,"receipt_footer"?: string | null,"receipt_show_stylists"?: boolean,"settings"?: NonNullable<Json>,"slug"?: string | null,"tax_rate_retail_bp"?: number,"tax_rate_services_bp"?: number,"updated_at"?: string,"yelp_url"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"calendar_views": {
                  Row: {
                    "business_id": string,"created_at": string,"created_by": string | null,"id": string,"location_id": string,"name": string,"owner_staff_id": string | null,"staff_ids": (string)[],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"location_id": string,"name": string,"owner_staff_id"?: string | null,"staff_ids": (string)[],"updated_at"?: string
                  }
                  Update: {
                    "business_id"?: string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"location_id"?: string,"name"?: string,"owner_staff_id"?: string | null,"staff_ids"?: (string)[],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "calendar_views_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "calendar_views_created_by_business_id_fkey"
      columns: ["created_by","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "calendar_views_location_id_business_id_fkey"
      columns: ["location_id","business_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "calendar_views_owner_staff_id_business_id_fkey"
      columns: ["owner_staff_id","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"card_requests": {
                  Row: {
                    "appointment_id": string | null,"business_id": string,"channel": string,"client_id": string,"created_at": string,"created_by": string | null,"deposit_cents": number,"done_at": string | null,"expires_at": string,"from_account": boolean,"id": string,"location_id": string,"sent_to": string,"status": string,"token_hash": string
                  }
                  ComputedFields: never
                  Insert: {
                    "appointment_id"?: string | null,"business_id": string,"channel": string,"client_id": string,"created_at"?: string,"created_by"?: string | null,"deposit_cents"?: number,"done_at"?: string | null,"expires_at": string,"from_account"?: boolean,"id"?: string,"location_id": string,"sent_to": string,"status"?: string,"token_hash": string
                  }
                  Update: {
                    "appointment_id"?: string | null,"business_id"?: string,"channel"?: string,"client_id"?: string,"created_at"?: string,"created_by"?: string | null,"deposit_cents"?: number,"done_at"?: string | null,"expires_at"?: string,"from_account"?: boolean,"id"?: string,"location_id"?: string,"sent_to"?: string,"status"?: string,"token_hash"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "card_requests_appointment_id_fkey"
      columns: ["appointment_id"]
isOneToOne: false
      referencedRelation: "appointments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "card_requests_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "card_requests_client_id_business_id_fkey"
      columns: ["client_id","business_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "card_requests_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "card_requests_location_id_fkey"
      columns: ["location_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id"]
    }
                  ]
                },"cash_closeouts": {
                  Row: {
                    "business_id": string,"closed_at": string,"closed_by": string | null,"counted_cents": number,"day": string,"expected_cents": number,"float_cents": number,"id": string,"location_id": string,"note": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"closed_at"?: string,"closed_by"?: string | null,"counted_cents": number,"day": string,"expected_cents": number,"float_cents"?: number,"id"?: string,"location_id": string,"note"?: string | null
                  }
                  Update: {
                    "business_id"?: string,"closed_at"?: string,"closed_by"?: string | null,"counted_cents"?: number,"day"?: string,"expected_cents"?: number,"float_cents"?: number,"id"?: string,"location_id"?: string,"note"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "cash_closeouts_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "cash_closeouts_closed_by_business_id_fkey"
      columns: ["closed_by","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "cash_closeouts_location_id_business_id_fkey"
      columns: ["location_id","business_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"client_accounts": {
                  Row: {
                    "business_id": string,"client_id": string,"created_at": string,"id": string,"last_sign_in_at": string | null,"verified_channel": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"client_id": string,"created_at"?: string,"id"?: string,"last_sign_in_at"?: string | null,"verified_channel": string
                  }
                  Update: {
                    "business_id"?: string,"client_id"?: string,"created_at"?: string,"id"?: string,"last_sign_in_at"?: string | null,"verified_channel"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "client_accounts_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "client_accounts_client_id_business_id_fkey"
      columns: ["client_id","business_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"client_cards": {
                  Row: {
                    "business_id": string,"client_id": string,"consent_id": string,"created_at": string,"id": string,"label": string,"payment_method_ref": string,"provider": string,"removed_at": string | null,"removed_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"client_id": string,"consent_id": string,"created_at"?: string,"id"?: string,"label": string,"payment_method_ref": string,"provider": string,"removed_at"?: string | null,"removed_by"?: string | null
                  }
                  Update: {
                    "business_id"?: string,"client_id"?: string,"consent_id"?: string,"created_at"?: string,"id"?: string,"label"?: string,"payment_method_ref"?: string,"provider"?: string,"removed_at"?: string | null,"removed_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "client_cards_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "client_cards_client_id_business_id_fkey"
      columns: ["client_id","business_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "client_cards_consent_id_fkey"
      columns: ["consent_id"]
isOneToOne: false
      referencedRelation: "policy_consents"
      referencedColumns: ["id"]
    }
                  ]
                },"client_consent_events": {
                  Row: {
                    "business_id": string,"channel": string,"client_id": string,"created_at": string,"detail": string | null,"granted": boolean,"id": string,"purpose": string,"source": string,"staff_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"channel": string,"client_id": string,"created_at"?: string,"detail"?: string | null,"granted": boolean,"id"?: string,"purpose": string,"source": string,"staff_id"?: string | null
                  }
                  Update: {
                    "business_id"?: string,"channel"?: string,"client_id"?: string,"created_at"?: string,"detail"?: string | null,"granted"?: boolean,"id"?: string,"purpose"?: string,"source"?: string,"staff_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "client_consent_events_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "client_consent_events_client_id_fkey"
      columns: ["client_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "client_consent_events_staff_id_fkey"
      columns: ["staff_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id"]
    }
                  ]
                },"client_forms": {
                  Row: {
                    "answers": NonNullable<Json>,"business_id": string,"client_id": string,"collected_by": string | null,"fields": NonNullable<Json>,"id": string,"signature": string | null,"signed_at": string,"template_id": string | null,"template_name": string
                  }
                  ComputedFields: never
                  Insert: {
                    "answers": NonNullable<Json>,"business_id": string,"client_id": string,"collected_by"?: string | null,"fields": NonNullable<Json>,"id"?: string,"signature"?: string | null,"signed_at"?: string,"template_id"?: string | null,"template_name": string
                  }
                  Update: {
                    "answers"?: NonNullable<Json>,"business_id"?: string,"client_id"?: string,"collected_by"?: string | null,"fields"?: NonNullable<Json>,"id"?: string,"signature"?: string | null,"signed_at"?: string,"template_id"?: string | null,"template_name"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "client_forms_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "client_forms_client_id_business_id_fkey"
      columns: ["client_id","business_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "client_forms_collected_by_business_id_fkey"
      columns: ["collected_by","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "client_forms_template_id_business_id_fkey"
      columns: ["template_id","business_id"]
isOneToOne: false
      referencedRelation: "form_templates"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"client_formulas": {
                  Row: {
                    "appointment_item_id": string | null,"business_id": string,"client_id": string,"created_at": string,"formula": string,"id": string,"notes": string | null,"staff_id": string,"visit_date": string
                  }
                  ComputedFields: never
                  Insert: {
                    "appointment_item_id"?: string | null,"business_id": string,"client_id": string,"created_at"?: string,"formula": string,"id"?: string,"notes"?: string | null,"staff_id": string,"visit_date"?: string
                  }
                  Update: {
                    "appointment_item_id"?: string | null,"business_id"?: string,"client_id"?: string,"created_at"?: string,"formula"?: string,"id"?: string,"notes"?: string | null,"staff_id"?: string,"visit_date"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "client_formulas_appointment_item_id_fkey"
      columns: ["appointment_item_id"]
isOneToOne: false
      referencedRelation: "appointment_items"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "client_formulas_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "client_formulas_client_id_business_id_fkey"
      columns: ["client_id","business_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "client_formulas_staff_id_business_id_fkey"
      columns: ["staff_id","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"client_memberships": {
                  Row: {
                    "allow_pause": boolean,"anchor_on": string,"business_id": string,"cancel_notice_days": number,"cancel_reason": string | null,"canceled_at": string | null,"cancels_on": string | null,"card_label": string | null,"client_id": string,"created_at": string,"created_by": string | null,"current_period_end": string,"current_period_start": string,"failed_attempts": number,"id": string,"interval_count": number,"interval_unit": string,"location_id": string,"max_pause_periods": number,"min_term_periods": number,"name": string,"next_retry_at": string | null,"pause_from": string | null,"payment_method_ref": string,"periods_paid": number,"plan_id": string | null,"price_cents": number,"provider": string,"resume_on": string | null,"retail_discount_pct": number,"sale_id": string | null,"service_discount_pct": number,"started_on": string,"status": Database["public"]['Enums']["membership_status"]
                  }
                  ComputedFields: never
                  Insert: {
                    "allow_pause"?: boolean,"anchor_on": string,"business_id": string,"cancel_notice_days"?: number,"cancel_reason"?: string | null,"canceled_at"?: string | null,"cancels_on"?: string | null,"card_label"?: string | null,"client_id": string,"created_at"?: string,"created_by"?: string | null,"current_period_end": string,"current_period_start": string,"failed_attempts"?: number,"id"?: string,"interval_count": number,"interval_unit": string,"location_id": string,"max_pause_periods"?: number,"min_term_periods"?: number,"name": string,"next_retry_at"?: string | null,"pause_from"?: string | null,"payment_method_ref": string,"periods_paid"?: number,"plan_id"?: string | null,"price_cents": number,"provider"?: string,"resume_on"?: string | null,"retail_discount_pct"?: number,"sale_id"?: string | null,"service_discount_pct"?: number,"started_on": string,"status"?: Database["public"]['Enums']["membership_status"]
                  }
                  Update: {
                    "allow_pause"?: boolean,"anchor_on"?: string,"business_id"?: string,"cancel_notice_days"?: number,"cancel_reason"?: string | null,"canceled_at"?: string | null,"cancels_on"?: string | null,"card_label"?: string | null,"client_id"?: string,"created_at"?: string,"created_by"?: string | null,"current_period_end"?: string,"current_period_start"?: string,"failed_attempts"?: number,"id"?: string,"interval_count"?: number,"interval_unit"?: string,"location_id"?: string,"max_pause_periods"?: number,"min_term_periods"?: number,"name"?: string,"next_retry_at"?: string | null,"pause_from"?: string | null,"payment_method_ref"?: string,"periods_paid"?: number,"plan_id"?: string | null,"price_cents"?: number,"provider"?: string,"resume_on"?: string | null,"retail_discount_pct"?: number,"sale_id"?: string | null,"service_discount_pct"?: number,"started_on"?: string,"status"?: Database["public"]['Enums']["membership_status"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "client_memberships_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "client_memberships_client_id_fkey"
      columns: ["client_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "client_memberships_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "client_memberships_location_id_fkey"
      columns: ["location_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "client_memberships_plan_id_fkey"
      columns: ["plan_id"]
isOneToOne: false
      referencedRelation: "membership_plans"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "client_memberships_sale_id_fkey"
      columns: ["sale_id"]
isOneToOne: false
      referencedRelation: "sales"
      referencedColumns: ["id"]
    }
                  ]
                },"client_messages": {
                  Row: {
                    "appointment_id": string | null,"body": string,"business_id": string,"channel": string,"client_id": string,"created_at": string,"id": string,"outbox_id": string | null,"promotion_id": string | null,"purpose": string,"sent_by": string | null,"subject": string | null,"template": string
                  }
                  ComputedFields: never
                  Insert: {
                    "appointment_id"?: string | null,"body": string,"business_id": string,"channel": string,"client_id": string,"created_at"?: string,"id"?: string,"outbox_id"?: string | null,"promotion_id"?: string | null,"purpose": string,"sent_by"?: string | null,"subject"?: string | null,"template": string
                  }
                  Update: {
                    "appointment_id"?: string | null,"body"?: string,"business_id"?: string,"channel"?: string,"client_id"?: string,"created_at"?: string,"id"?: string,"outbox_id"?: string | null,"promotion_id"?: string | null,"purpose"?: string,"sent_by"?: string | null,"subject"?: string | null,"template"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "client_messages_appointment_id_fkey"
      columns: ["appointment_id"]
isOneToOne: false
      referencedRelation: "appointments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "client_messages_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "client_messages_client_id_fkey"
      columns: ["client_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "client_messages_outbox_id_fkey"
      columns: ["outbox_id"]
isOneToOne: false
      referencedRelation: "outbox_messages"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "client_messages_promotion_id_fkey"
      columns: ["promotion_id"]
isOneToOne: false
      referencedRelation: "promotions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "client_messages_sent_by_fkey"
      columns: ["sent_by"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id"]
    }
                  ]
                },"client_package_items": {
                  Row: {
                    "business_id": string,"client_package_id": string,"id": string,"service_id": string,"total": number,"use_value_cents": number,"used": number
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"client_package_id": string,"id"?: string,"service_id": string,"total": number,"use_value_cents": number,"used"?: number
                  }
                  Update: {
                    "business_id"?: string,"client_package_id"?: string,"id"?: string,"service_id"?: string,"total"?: number,"use_value_cents"?: number,"used"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "client_package_items_client_package_id_business_id_fkey"
      columns: ["client_package_id","business_id"]
isOneToOne: false
      referencedRelation: "client_packages"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "client_package_items_service_id_fkey"
      columns: ["service_id"]
isOneToOne: false
      referencedRelation: "services"
      referencedColumns: ["id"]
    }
                  ]
                },"client_packages": {
                  Row: {
                    "business_id": string,"cancel_reason": string | null,"canceled_at": string | null,"canceled_by": string | null,"client_id": string,"created_at": string,"created_by": string | null,"expires_at": string | null,"id": string,"levels": (Database["public"]['Enums']["staff_level"])[] | null,"name": string,"price_cents": number,"refunded_cents": number,"sale_id": string | null,"status": Database["public"]['Enums']["client_package_status"],"template_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"cancel_reason"?: string | null,"canceled_at"?: string | null,"canceled_by"?: string | null,"client_id": string,"created_at"?: string,"created_by"?: string | null,"expires_at"?: string | null,"id"?: string,"levels"?: (Database["public"]['Enums']["staff_level"])[] | null,"name": string,"price_cents": number,"refunded_cents"?: number,"sale_id"?: string | null,"status"?: Database["public"]['Enums']["client_package_status"],"template_id"?: string | null
                  }
                  Update: {
                    "business_id"?: string,"cancel_reason"?: string | null,"canceled_at"?: string | null,"canceled_by"?: string | null,"client_id"?: string,"created_at"?: string,"created_by"?: string | null,"expires_at"?: string | null,"id"?: string,"levels"?: (Database["public"]['Enums']["staff_level"])[] | null,"name"?: string,"price_cents"?: number,"refunded_cents"?: number,"sale_id"?: string | null,"status"?: Database["public"]['Enums']["client_package_status"],"template_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "client_packages_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "client_packages_canceled_by_business_id_fkey"
      columns: ["canceled_by","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "client_packages_client_id_fkey"
      columns: ["client_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "client_packages_created_by_business_id_fkey"
      columns: ["created_by","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "client_packages_sale_id_fkey"
      columns: ["sale_id"]
isOneToOne: false
      referencedRelation: "sales"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "client_packages_template_id_fkey"
      columns: ["template_id"]
isOneToOne: false
      referencedRelation: "package_templates"
      referencedColumns: ["id"]
    }
                  ]
                },"client_patch_tests": {
                  Row: {
                    "business_id": string,"client_id": string,"created_at": string,"id": string,"notes": string | null,"performed_by": string,"products": string,"result": Database["public"]['Enums']["patch_test_result"],"tested_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"client_id": string,"created_at"?: string,"id"?: string,"notes"?: string | null,"performed_by": string,"products": string,"result": Database["public"]['Enums']["patch_test_result"],"tested_at": string
                  }
                  Update: {
                    "business_id"?: string,"client_id"?: string,"created_at"?: string,"id"?: string,"notes"?: string | null,"performed_by"?: string,"products"?: string,"result"?: Database["public"]['Enums']["patch_test_result"],"tested_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "client_patch_tests_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "client_patch_tests_client_id_business_id_fkey"
      columns: ["client_id","business_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "client_patch_tests_performed_by_business_id_fkey"
      columns: ["performed_by","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"client_sessions": {
                  Row: {
                    "account_id": string,"business_id": string,"created_at": string,"expires_at": string,"id": string,"ip_hash": string | null,"revoked_at": string | null,"token_hash": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"business_id": string,"created_at"?: string,"expires_at": string,"id"?: string,"ip_hash"?: string | null,"revoked_at"?: string | null,"token_hash": string
                  }
                  Update: {
                    "account_id"?: string,"business_id"?: string,"created_at"?: string,"expires_at"?: string,"id"?: string,"ip_hash"?: string | null,"revoked_at"?: string | null,"token_hash"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "client_sessions_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "client_accounts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "client_sessions_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    }
                  ]
                },"clients": {
                  Row: {
                    "allergies": string | null,"appointment_email_ok": boolean,"appointment_sms_ok": boolean,"birth_day": number | null,"birth_month": number | null,"business_id": string,"consent_signed_on": string | null,"created_at": string,"email": string | null,"email_opt_in": boolean,"first_name": string,"id": string,"last_name": string,"notes": string | null,"phone": string | null,"phone_digits": string | null,"photo_consent_by": string | null,"photo_consent_on": string | null,"preferences": string | null,"preferred_staff_id": string | null,"search_name": string | null,"sms_opt_in": boolean,"sms_stopped_at": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "allergies"?: string | null,"appointment_email_ok"?: boolean,"appointment_sms_ok"?: boolean,"birth_day"?: number | null,"birth_month"?: number | null,"business_id": string,"consent_signed_on"?: string | null,"created_at"?: string,"email"?: string | null,"email_opt_in"?: boolean,"first_name": string,"id"?: string,"last_name"?: string,"notes"?: string | null,"phone"?: string | null,"phone_digits"?: never,"photo_consent_by"?: string | null,"photo_consent_on"?: string | null,"preferences"?: string | null,"preferred_staff_id"?: string | null,"search_name"?: never,"sms_opt_in"?: boolean,"sms_stopped_at"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "allergies"?: string | null,"appointment_email_ok"?: boolean,"appointment_sms_ok"?: boolean,"birth_day"?: number | null,"birth_month"?: number | null,"business_id"?: string,"consent_signed_on"?: string | null,"created_at"?: string,"email"?: string | null,"email_opt_in"?: boolean,"first_name"?: string,"id"?: string,"last_name"?: string,"notes"?: string | null,"phone"?: string | null,"phone_digits"?: never,"photo_consent_by"?: string | null,"photo_consent_on"?: string | null,"preferences"?: string | null,"preferred_staff_id"?: string | null,"search_name"?: never,"sms_opt_in"?: boolean,"sms_stopped_at"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "clients_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "clients_photo_consent_by_fkey"
      columns: ["photo_consent_by"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "clients_preferred_staff_id_business_id_fkey"
      columns: ["preferred_staff_id","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"commission_plan_versions": {
                  Row: {
                    "business_id": string,"created_at": string,"created_by": string | null,"id": string,"plan_id": string,"rules": NonNullable<Json>
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"plan_id": string,"rules": NonNullable<Json>
                  }
                  Update: {
                    "business_id"?: string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"plan_id"?: string,"rules"?: NonNullable<Json>
                  }
                  Relationships: [
                    {
      foreignKeyName: "commission_plan_versions_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "commission_plan_versions_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "commission_plan_versions_plan_id_business_id_fkey"
      columns: ["plan_id","business_id"]
isOneToOne: false
      referencedRelation: "commission_plans"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"commission_plans": {
                  Row: {
                    "archived_at": string | null,"business_id": string,"created_at": string,"current_version_id": string | null,"id": string,"is_default": boolean,"name": string
                  }
                  ComputedFields: never
                  Insert: {
                    "archived_at"?: string | null,"business_id": string,"created_at"?: string,"current_version_id"?: string | null,"id"?: string,"is_default"?: boolean,"name": string
                  }
                  Update: {
                    "archived_at"?: string | null,"business_id"?: string,"created_at"?: string,"current_version_id"?: string | null,"id"?: string,"is_default"?: boolean,"name"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "commission_plans_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "commission_plans_current_version_id_fkey"
      columns: ["current_version_id"]
isOneToOne: false
      referencedRelation: "commission_plan_versions"
      referencedColumns: ["id"]
    }
                  ]
                },"data_exports": {
                  Row: {
                    "business_id": string,"bytes": number,"created_at": string,"id": string,"row_counts": NonNullable<Json>,"staff_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"bytes": number,"created_at"?: string,"id"?: string,"row_counts": NonNullable<Json>,"staff_id"?: string | null
                  }
                  Update: {
                    "business_id"?: string,"bytes"?: number,"created_at"?: string,"id"?: string,"row_counts"?: NonNullable<Json>,"staff_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "data_exports_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "data_exports_staff_id_fkey"
      columns: ["staff_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id"]
    }
                  ]
                },"denise_briefs": {
                  Row: {
                    "created_at": string,"day": string,"facts_hash": string,"location_id": string,"model": string,"text": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"day": string,"facts_hash": string,"location_id": string,"model": string,"text": string
                  }
                  Update: {
                    "created_at"?: string,"day"?: string,"facts_hash"?: string,"location_id"?: string,"model"?: string,"text"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "denise_briefs_location_id_fkey"
      columns: ["location_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id"]
    }
                  ]
                },"denise_dismissals": {
                  Row: {
                    "business_id": string,"created_at": string,"day": string,"dismissed_by": string | null,"id": string,"item_key": string,"location_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"created_at"?: string,"day": string,"dismissed_by"?: string | null,"id"?: string,"item_key": string,"location_id": string
                  }
                  Update: {
                    "business_id"?: string,"created_at"?: string,"day"?: string,"dismissed_by"?: string | null,"id"?: string,"item_key"?: string,"location_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "denise_dismissals_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "denise_dismissals_dismissed_by_business_id_fkey"
      columns: ["dismissed_by","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "denise_dismissals_location_id_business_id_fkey"
      columns: ["location_id","business_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"device_switches": {
                  Row: {
                    "business_id": string,"created_at": string,"device_id": string,"id": number,"outcome": string,"staff_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"created_at"?: string,"device_id": string,"id"?: never,"outcome": string,"staff_id"?: string | null
                  }
                  Update: {
                    "business_id"?: string,"created_at"?: string,"device_id"?: string,"id"?: never,"outcome"?: string,"staff_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "device_switches_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "device_switches_device_id_fkey"
      columns: ["device_id"]
isOneToOne: false
      referencedRelation: "shared_devices"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "device_switches_staff_id_fkey"
      columns: ["staff_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id"]
    }
                  ]
                },"event_agreements": {
                  Row: {
                    "agreed_at": string,"business_id": string,"deposit_cents": number,"event_id": string,"id": string,"ip_hash": string | null,"link_id": string | null,"schedule": NonNullable<Json>,"terms_id": string,"terms_text": string,"terms_version": number,"total_cents": number,"typed_name": string
                  }
                  ComputedFields: never
                  Insert: {
                    "agreed_at"?: string,"business_id": string,"deposit_cents": number,"event_id": string,"id"?: string,"ip_hash"?: string | null,"link_id"?: string | null,"schedule": NonNullable<Json>,"terms_id": string,"terms_text": string,"terms_version": number,"total_cents": number,"typed_name": string
                  }
                  Update: {
                    "agreed_at"?: string,"business_id"?: string,"deposit_cents"?: number,"event_id"?: string,"id"?: string,"ip_hash"?: string | null,"link_id"?: string | null,"schedule"?: NonNullable<Json>,"terms_id"?: string,"terms_text"?: string,"terms_version"?: number,"total_cents"?: number,"typed_name"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "event_agreements_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "event_agreements_event_id_business_id_fkey"
      columns: ["event_id","business_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "event_agreements_link_id_fkey"
      columns: ["link_id"]
isOneToOne: false
      referencedRelation: "event_links"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "event_agreements_terms_id_fkey"
      columns: ["terms_id"]
isOneToOne: false
      referencedRelation: "event_terms"
      referencedColumns: ["id"]
    }
                  ]
                },"event_history": {
                  Row: {
                    "business_id": string,"created_at": string,"detail": string | null,"event_id": string,"id": string,"kind": string,"staff_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"created_at"?: string,"detail"?: string | null,"event_id": string,"id"?: string,"kind": string,"staff_id"?: string | null
                  }
                  Update: {
                    "business_id"?: string,"created_at"?: string,"detail"?: string | null,"event_id"?: string,"id"?: string,"kind"?: string,"staff_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "event_history_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "event_history_event_id_business_id_fkey"
      columns: ["event_id","business_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "event_history_staff_id_business_id_fkey"
      columns: ["staff_id","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"event_links": {
                  Row: {
                    "business_id": string,"channel": string,"created_at": string,"created_by": string | null,"done_at": string | null,"event_id": string,"expires_at": string,"id": string,"kind": string,"member_id": string | null,"sent_to": string,"status": string,"terms_id": string | null,"token_hash": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"channel": string,"created_at"?: string,"created_by"?: string | null,"done_at"?: string | null,"event_id": string,"expires_at": string,"id"?: string,"kind": string,"member_id"?: string | null,"sent_to": string,"status"?: string,"terms_id"?: string | null,"token_hash": string
                  }
                  Update: {
                    "business_id"?: string,"channel"?: string,"created_at"?: string,"created_by"?: string | null,"done_at"?: string | null,"event_id"?: string,"expires_at"?: string,"id"?: string,"kind"?: string,"member_id"?: string | null,"sent_to"?: string,"status"?: string,"terms_id"?: string | null,"token_hash"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "event_links_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "event_links_created_by_business_id_fkey"
      columns: ["created_by","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "event_links_event_id_business_id_fkey"
      columns: ["event_id","business_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "event_links_member_id_business_id_fkey"
      columns: ["member_id","business_id"]
isOneToOne: false
      referencedRelation: "event_members"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "event_links_terms_id_fkey"
      columns: ["terms_id"]
isOneToOne: false
      referencedRelation: "event_terms"
      referencedColumns: ["id"]
    }
                  ]
                },"event_members": {
                  Row: {
                    "business_id": string,"created_at": string,"email": string | null,"event_id": string,"hair_minutes": number,"id": string,"makeup_minutes": number,"name": string,"package_id": string | null,"package_name": string,"party_role": Database["public"]['Enums']["event_party_role"],"pays_own": boolean,"phone": string | null,"position": number,"price_cents": number
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"created_at"?: string,"email"?: string | null,"event_id": string,"hair_minutes"?: number,"id"?: string,"makeup_minutes"?: number,"name": string,"package_id"?: string | null,"package_name": string,"party_role": Database["public"]['Enums']["event_party_role"],"pays_own"?: boolean,"phone"?: string | null,"position": number,"price_cents": number
                  }
                  Update: {
                    "business_id"?: string,"created_at"?: string,"email"?: string | null,"event_id"?: string,"hair_minutes"?: number,"id"?: string,"makeup_minutes"?: number,"name"?: string,"package_id"?: string | null,"package_name"?: string,"party_role"?: Database["public"]['Enums']["event_party_role"],"pays_own"?: boolean,"phone"?: string | null,"position"?: number,"price_cents"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "event_members_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "event_members_event_id_business_id_fkey"
      columns: ["event_id","business_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "event_members_package_id_business_id_fkey"
      columns: ["package_id","business_id"]
isOneToOne: false
      referencedRelation: "event_packages"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"event_packages": {
                  Row: {
                    "business_id": string,"created_at": string,"hair_minutes": number,"id": string,"is_active": boolean,"is_trial": boolean,"makeup_minutes": number,"name": string,"party_role": Database["public"]['Enums']["event_party_role"] | null,"position": number,"price_cents": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"created_at"?: string,"hair_minutes"?: number,"id"?: string,"is_active"?: boolean,"is_trial"?: boolean,"makeup_minutes"?: number,"name": string,"party_role"?: Database["public"]['Enums']["event_party_role"] | null,"position"?: number,"price_cents": number,"updated_at"?: string
                  }
                  Update: {
                    "business_id"?: string,"created_at"?: string,"hair_minutes"?: number,"id"?: string,"is_active"?: boolean,"is_trial"?: boolean,"makeup_minutes"?: number,"name"?: string,"party_role"?: Database["public"]['Enums']["event_party_role"] | null,"position"?: number,"price_cents"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "event_packages_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    }
                  ]
                },"event_payments": {
                  Row: {
                    "amount_cents": number,"attempts": number,"business_id": string,"card_label": string | null,"charge_after": string | null,"created_at": string,"due_on": string,"event_id": string,"failure_reason": string | null,"id": string,"kind": string,"member_id": string | null,"member_name": string | null,"paid_at": string | null,"provider": string | null,"provider_reference": string | null,"receipt_sent_at": string | null,"reminded_at": string | null,"status": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_cents": number,"attempts"?: number,"business_id": string,"card_label"?: string | null,"charge_after"?: string | null,"created_at"?: string,"due_on": string,"event_id": string,"failure_reason"?: string | null,"id"?: string,"kind": string,"member_id"?: string | null,"member_name"?: string | null,"paid_at"?: string | null,"provider"?: string | null,"provider_reference"?: string | null,"receipt_sent_at"?: string | null,"reminded_at"?: string | null,"status": string
                  }
                  Update: {
                    "amount_cents"?: number,"attempts"?: number,"business_id"?: string,"card_label"?: string | null,"charge_after"?: string | null,"created_at"?: string,"due_on"?: string,"event_id"?: string,"failure_reason"?: string | null,"id"?: string,"kind"?: string,"member_id"?: string | null,"member_name"?: string | null,"paid_at"?: string | null,"provider"?: string | null,"provider_reference"?: string | null,"receipt_sent_at"?: string | null,"reminded_at"?: string | null,"status"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "event_payments_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "event_payments_event_id_business_id_fkey"
      columns: ["event_id","business_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "event_payments_member_id_business_id_fkey"
      columns: ["member_id","business_id"]
isOneToOne: false
      referencedRelation: "event_members"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"event_photos": {
                  Row: {
                    "business_id": string,"created_at": string,"created_by": string | null,"event_id": string,"id": string,"kind": string,"storage_path": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"created_at"?: string,"created_by"?: string | null,"event_id": string,"id"?: string,"kind": string,"storage_path": string
                  }
                  Update: {
                    "business_id"?: string,"created_at"?: string,"created_by"?: string | null,"event_id"?: string,"id"?: string,"kind"?: string,"storage_path"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "event_photos_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "event_photos_created_by_business_id_fkey"
      columns: ["created_by","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "event_photos_event_id_business_id_fkey"
      columns: ["event_id","business_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"event_settings": {
                  Row: {
                    "buffer_minutes": number,"business_id": string,"deposit_pct": number,"deposit_refundable": boolean,"early_start_fee_cents": number,"early_start_minute": number,"final_payment_days": number,"headcount_cutoff_days": number,"inquiries_enabled": boolean,"second_payment_days": number,"second_payment_pct": number,"service_charge_pct": number,"service_charge_team_pct": number,"touch_up_minutes": number,"travel_fee_cents": number,"travel_free_miles": number,"travel_minutes": number,"travel_per_mile_cents": number,"travel_team_pct": number,"trial_service_id": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "buffer_minutes"?: number,"business_id": string,"deposit_pct"?: number,"deposit_refundable"?: boolean,"early_start_fee_cents"?: number,"early_start_minute"?: number,"final_payment_days"?: number,"headcount_cutoff_days"?: number,"inquiries_enabled"?: boolean,"second_payment_days"?: number,"second_payment_pct"?: number,"service_charge_pct"?: number,"service_charge_team_pct"?: number,"touch_up_minutes"?: number,"travel_fee_cents"?: number,"travel_free_miles"?: number,"travel_minutes"?: number,"travel_per_mile_cents"?: number,"travel_team_pct"?: number,"trial_service_id"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "buffer_minutes"?: number,"business_id"?: string,"deposit_pct"?: number,"deposit_refundable"?: boolean,"early_start_fee_cents"?: number,"early_start_minute"?: number,"final_payment_days"?: number,"headcount_cutoff_days"?: number,"inquiries_enabled"?: boolean,"second_payment_days"?: number,"second_payment_pct"?: number,"service_charge_pct"?: number,"service_charge_team_pct"?: number,"touch_up_minutes"?: number,"travel_fee_cents"?: number,"travel_free_miles"?: number,"travel_minutes"?: number,"travel_per_mile_cents"?: number,"travel_team_pct"?: number,"trial_service_id"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "event_settings_business_id_fkey"
      columns: ["business_id"]
isOneToOne: true
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "event_settings_trial_service_id_fkey"
      columns: ["trial_service_id"]
isOneToOne: false
      referencedRelation: "services"
      referencedColumns: ["id"]
    }
                  ]
                },"event_tasks": {
                  Row: {
                    "business_id": string,"ends_at": string,"event_id": string,"id": string,"kind": string,"lane": number,"member_id": string | null,"role": string,"staff_id": string | null,"starts_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"ends_at": string,"event_id": string,"id"?: string,"kind": string,"lane": number,"member_id"?: string | null,"role": string,"staff_id"?: string | null,"starts_at": string
                  }
                  Update: {
                    "business_id"?: string,"ends_at"?: string,"event_id"?: string,"id"?: string,"kind"?: string,"lane"?: number,"member_id"?: string | null,"role"?: string,"staff_id"?: string | null,"starts_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "event_tasks_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "event_tasks_event_id_business_id_fkey"
      columns: ["event_id","business_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "event_tasks_member_id_business_id_fkey"
      columns: ["member_id","business_id"]
isOneToOne: false
      referencedRelation: "event_members"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "event_tasks_staff_id_business_id_fkey"
      columns: ["staff_id","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"event_terms": {
                  Row: {
                    "body": string,"business_id": string,"created_at": string,"created_by": string | null,"id": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "body": string,"business_id": string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"version": number
                  }
                  Update: {
                    "body"?: string,"business_id"?: string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "event_terms_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "event_terms_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id"]
    }
                  ]
                },"events": {
                  Row: {
                    "billing": string,"booked_at": string | null,"business_id": string,"card_label": string | null,"card_provider": string | null,"card_ref": string | null,"client_id": string | null,"created_at": string,"created_by": string | null,"deposit_cents": number,"early_fee_cents": number,"event_date": string,"id": string,"inquiry_party_size": number | null,"inquiry_services": string | null,"location_id": string,"look_notes": string | null,"lost_reason": string | null,"main_cents": number,"notes": string | null,"on_location": boolean,"ready_by": string | null,"sale_id": string | null,"service_charge_cents": number,"source": string,"status": Database["public"]['Enums']["event_status"],"status_changed_at": string,"subtotal_cents": number,"tax_cents": number,"title": string,"total_cents": number,"travel_fee_cents": number,"travel_miles": number,"travel_minutes": number,"updated_at": string,"venue_address": string | null,"venue_name": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "billing"?: string,"booked_at"?: string | null,"business_id": string,"card_label"?: string | null,"card_provider"?: string | null,"card_ref"?: string | null,"client_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"deposit_cents"?: number,"early_fee_cents"?: number,"event_date": string,"id"?: string,"inquiry_party_size"?: number | null,"inquiry_services"?: string | null,"location_id": string,"look_notes"?: string | null,"lost_reason"?: string | null,"main_cents"?: number,"notes"?: string | null,"on_location"?: boolean,"ready_by"?: string | null,"sale_id"?: string | null,"service_charge_cents"?: number,"source"?: string,"status"?: Database["public"]['Enums']["event_status"],"status_changed_at"?: string,"subtotal_cents"?: number,"tax_cents"?: number,"title": string,"total_cents"?: number,"travel_fee_cents"?: number,"travel_miles"?: number,"travel_minutes"?: number,"updated_at"?: string,"venue_address"?: string | null,"venue_name"?: string | null
                  }
                  Update: {
                    "billing"?: string,"booked_at"?: string | null,"business_id"?: string,"card_label"?: string | null,"card_provider"?: string | null,"card_ref"?: string | null,"client_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"deposit_cents"?: number,"early_fee_cents"?: number,"event_date"?: string,"id"?: string,"inquiry_party_size"?: number | null,"inquiry_services"?: string | null,"location_id"?: string,"look_notes"?: string | null,"lost_reason"?: string | null,"main_cents"?: number,"notes"?: string | null,"on_location"?: boolean,"ready_by"?: string | null,"sale_id"?: string | null,"service_charge_cents"?: number,"source"?: string,"status"?: Database["public"]['Enums']["event_status"],"status_changed_at"?: string,"subtotal_cents"?: number,"tax_cents"?: number,"title"?: string,"total_cents"?: number,"travel_fee_cents"?: number,"travel_miles"?: number,"travel_minutes"?: number,"updated_at"?: string,"venue_address"?: string | null,"venue_name"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "events_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "events_client_id_business_id_fkey"
      columns: ["client_id","business_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "events_created_by_business_id_fkey"
      columns: ["created_by","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "events_location_id_business_id_fkey"
      columns: ["location_id","business_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "events_sale_id_fkey"
      columns: ["sale_id"]
isOneToOne: false
      referencedRelation: "sales"
      referencedColumns: ["id"]
    }
                  ]
                },"form_templates": {
                  Row: {
                    "business_id": string,"created_at": string,"fields": NonNullable<Json>,"id": string,"intro": string | null,"is_active": boolean,"name": string,"required": Database["public"]['Enums']["form_requirement"],"service_ids": (string)[],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"created_at"?: string,"fields": NonNullable<Json>,"id"?: string,"intro"?: string | null,"is_active"?: boolean,"name": string,"required"?: Database["public"]['Enums']["form_requirement"],"service_ids"?: (string)[],"updated_at"?: string
                  }
                  Update: {
                    "business_id"?: string,"created_at"?: string,"fields"?: NonNullable<Json>,"id"?: string,"intro"?: string | null,"is_active"?: boolean,"name"?: string,"required"?: Database["public"]['Enums']["form_requirement"],"service_ids"?: (string)[],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "form_templates_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    }
                  ]
                },"formula_products": {
                  Row: {
                    "amount": number,"business_id": string,"formula_id": string,"id": string,"position": number,"product_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"business_id": string,"formula_id": string,"id"?: string,"position"?: number,"product_id": string
                  }
                  Update: {
                    "amount"?: number,"business_id"?: string,"formula_id"?: string,"id"?: string,"position"?: number,"product_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "formula_products_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "formula_products_formula_id_fkey"
      columns: ["formula_id"]
isOneToOne: false
      referencedRelation: "client_formulas"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "formula_products_product_id_business_id_fkey"
      columns: ["product_id","business_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"gift_card_events": {
                  Row: {
                    "amount_cents": number,"balance_after": number,"business_id": string,"card_id": string,"created_at": string,"id": string,"kind": string,"reason": string | null,"sale_id": string | null,"staff_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_cents": number,"balance_after": number,"business_id": string,"card_id": string,"created_at"?: string,"id"?: string,"kind": string,"reason"?: string | null,"sale_id"?: string | null,"staff_id"?: string | null
                  }
                  Update: {
                    "amount_cents"?: number,"balance_after"?: number,"business_id"?: string,"card_id"?: string,"created_at"?: string,"id"?: string,"kind"?: string,"reason"?: string | null,"sale_id"?: string | null,"staff_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "gift_card_events_card_id_business_id_fkey"
      columns: ["card_id","business_id"]
isOneToOne: false
      referencedRelation: "gift_cards"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "gift_card_events_sale_id_fkey"
      columns: ["sale_id"]
isOneToOne: false
      referencedRelation: "sales"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "gift_card_events_staff_id_business_id_fkey"
      columns: ["staff_id","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"gift_card_lookups": {
                  Row: {
                    "business_id": string,"code_hint": string | null,"created_at": string,"found": boolean,"id": string,"staff_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"code_hint"?: string | null,"created_at"?: string,"found": boolean,"id"?: string,"staff_id"?: string | null
                  }
                  Update: {
                    "business_id"?: string,"code_hint"?: string | null,"created_at"?: string,"found"?: boolean,"id"?: string,"staff_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "gift_card_lookups_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    }
                  ]
                },"gift_cards": {
                  Row: {
                    "balance_cents": number,"business_id": string,"client_id": string | null,"code": string,"created_at": string,"created_by": string | null,"expires_at": string | null,"id": string,"imported": boolean,"initial_cents": number,"kind": Database["public"]['Enums']["gift_card_kind"],"note": string | null,"physical": boolean,"recipient_email": string | null,"recipient_name": string | null,"sale_id": string | null,"status": Database["public"]['Enums']["gift_card_status"]
                  }
                  ComputedFields: never
                  Insert: {
                    "balance_cents": number,"business_id": string,"client_id"?: string | null,"code": string,"created_at"?: string,"created_by"?: string | null,"expires_at"?: string | null,"id"?: string,"imported"?: boolean,"initial_cents": number,"kind": Database["public"]['Enums']["gift_card_kind"],"note"?: string | null,"physical"?: boolean,"recipient_email"?: string | null,"recipient_name"?: string | null,"sale_id"?: string | null,"status"?: Database["public"]['Enums']["gift_card_status"]
                  }
                  Update: {
                    "balance_cents"?: number,"business_id"?: string,"client_id"?: string | null,"code"?: string,"created_at"?: string,"created_by"?: string | null,"expires_at"?: string | null,"id"?: string,"imported"?: boolean,"initial_cents"?: number,"kind"?: Database["public"]['Enums']["gift_card_kind"],"note"?: string | null,"physical"?: boolean,"recipient_email"?: string | null,"recipient_name"?: string | null,"sale_id"?: string | null,"status"?: Database["public"]['Enums']["gift_card_status"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "gift_cards_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "gift_cards_client_id_fkey"
      columns: ["client_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "gift_cards_created_by_business_id_fkey"
      columns: ["created_by","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "gift_cards_sale_id_fkey"
      columns: ["sale_id"]
isOneToOne: false
      referencedRelation: "sales"
      referencedColumns: ["id"]
    }
                  ]
                },"goal_celebrations": {
                  Row: {
                    "business_id": string,"created_at": string,"goal_id": string,"milestone": number,"period_from": string,"staff_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"created_at"?: string,"goal_id": string,"milestone": number,"period_from": string,"staff_id": string
                  }
                  Update: {
                    "business_id"?: string,"created_at"?: string,"goal_id"?: string,"milestone"?: number,"period_from"?: string,"staff_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "goal_celebrations_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "goal_celebrations_goal_id_fkey"
      columns: ["goal_id"]
isOneToOne: false
      referencedRelation: "staff_goals"
      referencedColumns: ["id"]
    }
                  ]
                },"import_external_ids": {
                  Row: {
                    "business_id": string,"entity": string,"external_id": string,"imported_at": string,"internal_id": string,"source": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"entity": string,"external_id": string,"imported_at"?: string,"internal_id": string,"source": string
                  }
                  Update: {
                    "business_id"?: string,"entity"?: string,"external_id"?: string,"imported_at"?: string,"internal_id"?: string,"source"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "import_external_ids_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    }
                  ]
                },"insights": {
                  Row: {
                    "business_id": string,"computed_at": string,"data": NonNullable<Json>,"key": string,"kind": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"computed_at"?: string,"data": NonNullable<Json>,"key": string,"kind": string
                  }
                  Update: {
                    "business_id"?: string,"computed_at"?: string,"data"?: NonNullable<Json>,"key"?: string,"kind"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "insights_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    }
                  ]
                },"location_hours": {
                  Row: {
                    "business_id": string,"end_minute": number,"id": string,"location_id": string,"start_minute": number,"weekday": number
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"end_minute": number,"id"?: string,"location_id": string,"start_minute": number,"weekday": number
                  }
                  Update: {
                    "business_id"?: string,"end_minute"?: number,"id"?: string,"location_id"?: string,"start_minute"?: number,"weekday"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "location_hours_location_id_business_id_fkey"
      columns: ["location_id","business_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"locations": {
                  Row: {
                    "address_line1": string | null,"address_line2": string | null,"business_id": string,"calendar_version": number,"city": string | null,"country": string,"created_at": string,"id": string,"name": string,"phone": string | null,"postal_code": string | null,"region": string | null,"timezone": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "address_line1"?: string | null,"address_line2"?: string | null,"business_id": string,"calendar_version"?: number,"city"?: string | null,"country"?: string,"created_at"?: string,"id"?: string,"name": string,"phone"?: string | null,"postal_code"?: string | null,"region"?: string | null,"timezone": string,"updated_at"?: string
                  }
                  Update: {
                    "address_line1"?: string | null,"address_line2"?: string | null,"business_id"?: string,"calendar_version"?: number,"city"?: string | null,"country"?: string,"created_at"?: string,"id"?: string,"name"?: string,"phone"?: string | null,"postal_code"?: string | null,"region"?: string | null,"timezone"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "locations_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    }
                  ]
                },"marketing_automations": {
                  Row: {
                    "body": string,"business_id": string,"enabled": boolean,"kind": string,"settings": NonNullable<Json>,"subject": string,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "body": string,"business_id": string,"enabled"?: boolean,"kind": string,"settings"?: NonNullable<Json>,"subject": string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "body"?: string,"business_id"?: string,"enabled"?: boolean,"kind"?: string,"settings"?: NonNullable<Json>,"subject"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "marketing_automations_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "marketing_automations_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id"]
    }
                  ]
                },"marketing_messages": {
                  Row: {
                    "appointment_id": string | null,"body": string,"business_id": string,"channel": string,"client_id": string,"cycle_key": string,"id": string,"kind": string,"opt_out_token_hash": string,"opted_out_at": string | null,"outbox_message_id": string | null,"sent_at": string,"subject": string | null,"to_address": string
                  }
                  ComputedFields: never
                  Insert: {
                    "appointment_id"?: string | null,"body": string,"business_id": string,"channel": string,"client_id": string,"cycle_key": string,"id"?: string,"kind": string,"opt_out_token_hash": string,"opted_out_at"?: string | null,"outbox_message_id"?: string | null,"sent_at"?: string,"subject"?: string | null,"to_address": string
                  }
                  Update: {
                    "appointment_id"?: string | null,"body"?: string,"business_id"?: string,"channel"?: string,"client_id"?: string,"cycle_key"?: string,"id"?: string,"kind"?: string,"opt_out_token_hash"?: string,"opted_out_at"?: string | null,"outbox_message_id"?: string | null,"sent_at"?: string,"subject"?: string | null,"to_address"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "marketing_messages_appointment_id_fkey"
      columns: ["appointment_id"]
isOneToOne: false
      referencedRelation: "appointments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "marketing_messages_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "marketing_messages_client_id_fkey"
      columns: ["client_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "marketing_messages_outbox_message_id_fkey"
      columns: ["outbox_message_id"]
isOneToOne: false
      referencedRelation: "outbox_messages"
      referencedColumns: ["id"]
    }
                  ]
                },"membership_charges": {
                  Row: {
                    "amount_cents": number,"attempt": number,"business_id": string,"created_at": string,"failure_reason": string | null,"id": string,"membership_id": string,"period_start": string,"provider": string,"provider_reference": string | null,"sale_id": string | null,"status": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_cents": number,"attempt"?: number,"business_id": string,"created_at"?: string,"failure_reason"?: string | null,"id"?: string,"membership_id": string,"period_start": string,"provider": string,"provider_reference"?: string | null,"sale_id"?: string | null,"status": string
                  }
                  Update: {
                    "amount_cents"?: number,"attempt"?: number,"business_id"?: string,"created_at"?: string,"failure_reason"?: string | null,"id"?: string,"membership_id"?: string,"period_start"?: string,"provider"?: string,"provider_reference"?: string | null,"sale_id"?: string | null,"status"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "membership_charges_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "membership_charges_membership_id_fkey"
      columns: ["membership_id"]
isOneToOne: false
      referencedRelation: "client_memberships"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "membership_charges_sale_id_fkey"
      columns: ["sale_id"]
isOneToOne: false
      referencedRelation: "sales"
      referencedColumns: ["id"]
    }
                  ]
                },"membership_credits": {
                  Row: {
                    "allowance": number,"business_id": string,"id": string,"membership_id": string,"period_start": string,"service_id": string,"used": number
                  }
                  ComputedFields: never
                  Insert: {
                    "allowance": number,"business_id": string,"id"?: string,"membership_id": string,"period_start": string,"service_id": string,"used"?: number
                  }
                  Update: {
                    "allowance"?: number,"business_id"?: string,"id"?: string,"membership_id"?: string,"period_start"?: string,"service_id"?: string,"used"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "membership_credits_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "membership_credits_membership_id_fkey"
      columns: ["membership_id"]
isOneToOne: false
      referencedRelation: "client_memberships"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "membership_credits_service_id_fkey"
      columns: ["service_id"]
isOneToOne: false
      referencedRelation: "services"
      referencedColumns: ["id"]
    }
                  ]
                },"membership_events": {
                  Row: {
                    "business_id": string,"created_at": string,"detail": string | null,"id": string,"kind": string,"membership_id": string,"sale_id": string | null,"service_id": string | null,"staff_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"created_at"?: string,"detail"?: string | null,"id"?: string,"kind": string,"membership_id": string,"sale_id"?: string | null,"service_id"?: string | null,"staff_id"?: string | null
                  }
                  Update: {
                    "business_id"?: string,"created_at"?: string,"detail"?: string | null,"id"?: string,"kind"?: string,"membership_id"?: string,"sale_id"?: string | null,"service_id"?: string | null,"staff_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "membership_events_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "membership_events_membership_id_fkey"
      columns: ["membership_id"]
isOneToOne: false
      referencedRelation: "client_memberships"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "membership_events_sale_id_fkey"
      columns: ["sale_id"]
isOneToOne: false
      referencedRelation: "sales"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "membership_events_service_id_fkey"
      columns: ["service_id"]
isOneToOne: false
      referencedRelation: "services"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "membership_events_staff_id_fkey"
      columns: ["staff_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id"]
    }
                  ]
                },"membership_plan_services": {
                  Row: {
                    "business_id": string,"id": string,"plan_id": string,"quantity": number,"rollover": boolean,"service_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"id"?: string,"plan_id": string,"quantity": number,"rollover"?: boolean,"service_id": string
                  }
                  Update: {
                    "business_id"?: string,"id"?: string,"plan_id"?: string,"quantity"?: number,"rollover"?: boolean,"service_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "membership_plan_services_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "membership_plan_services_plan_id_fkey"
      columns: ["plan_id"]
isOneToOne: false
      referencedRelation: "membership_plans"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "membership_plan_services_service_id_fkey"
      columns: ["service_id"]
isOneToOne: false
      referencedRelation: "services"
      referencedColumns: ["id"]
    }
                  ]
                },"membership_plans": {
                  Row: {
                    "allow_pause": boolean,"business_id": string,"cancel_notice_days": number,"created_at": string,"description": string | null,"id": string,"interval_count": number,"interval_unit": string,"is_active": boolean,"max_pause_periods": number,"min_term_periods": number,"name": string,"price_cents": number,"retail_discount_pct": number,"service_discount_pct": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "allow_pause"?: boolean,"business_id": string,"cancel_notice_days"?: number,"created_at"?: string,"description"?: string | null,"id"?: string,"interval_count"?: number,"interval_unit"?: string,"is_active"?: boolean,"max_pause_periods"?: number,"min_term_periods"?: number,"name": string,"price_cents": number,"retail_discount_pct"?: number,"service_discount_pct"?: number,"updated_at"?: string
                  }
                  Update: {
                    "allow_pause"?: boolean,"business_id"?: string,"cancel_notice_days"?: number,"created_at"?: string,"description"?: string | null,"id"?: string,"interval_count"?: number,"interval_unit"?: string,"is_active"?: boolean,"max_pause_periods"?: number,"min_term_periods"?: number,"name"?: string,"price_cents"?: number,"retail_discount_pct"?: number,"service_discount_pct"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "membership_plans_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    }
                  ]
                },"notifications": {
                  Row: {
                    "ai_action_id": string | null,"appointment_id": string | null,"body": string,"business_id": string,"channel": string,"client_id": string | null,"created_at": string,"id": string,"location_id": string,"staff_id": string | null,"status": Database["public"]['Enums']["notification_status"],"template": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "ai_action_id"?: string | null,"appointment_id"?: string | null,"body": string,"business_id": string,"channel"?: string,"client_id"?: string | null,"created_at"?: string,"id"?: string,"location_id": string,"staff_id"?: string | null,"status"?: Database["public"]['Enums']["notification_status"],"template": string,"updated_at"?: string
                  }
                  Update: {
                    "ai_action_id"?: string | null,"appointment_id"?: string | null,"body"?: string,"business_id"?: string,"channel"?: string,"client_id"?: string | null,"created_at"?: string,"id"?: string,"location_id"?: string,"staff_id"?: string | null,"status"?: Database["public"]['Enums']["notification_status"],"template"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "notifications_ai_action_id_fkey"
      columns: ["ai_action_id"]
isOneToOne: false
      referencedRelation: "ai_actions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "notifications_appointment_id_business_id_location_id_fkey"
      columns: ["appointment_id","business_id","location_id"]
isOneToOne: false
      referencedRelation: "appointments"
      referencedColumns: ["id","business_id","location_id"]
    },{
      foreignKeyName: "notifications_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "notifications_client_id_business_id_fkey"
      columns: ["client_id","business_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "notifications_location_id_business_id_fkey"
      columns: ["location_id","business_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "notifications_staff_id_business_id_fkey"
      columns: ["staff_id","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"online_booking_attempts": {
                  Row: {
                    "appointment_id": string | null,"booked_at": string | null,"business_id": string,"claimed_at": string,"key_hash": string
                  }
                  ComputedFields: never
                  Insert: {
                    "appointment_id"?: string | null,"booked_at"?: string | null,"business_id": string,"claimed_at"?: string,"key_hash": string
                  }
                  Update: {
                    "appointment_id"?: string | null,"booked_at"?: string | null,"business_id"?: string,"claimed_at"?: string,"key_hash"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "online_booking_attempts_appointment_id_fkey"
      columns: ["appointment_id"]
isOneToOne: false
      referencedRelation: "appointments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "online_booking_attempts_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    }
                  ]
                },"online_booking_log": {
                  Row: {
                    "action": string,"appointment_id": string | null,"business_id": string,"client_id": string | null,"created_at": string,"id": string,"ip_hash": string | null,"source": string | null,"user_agent": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"appointment_id"?: string | null,"business_id": string,"client_id"?: string | null,"created_at"?: string,"id"?: string,"ip_hash"?: string | null,"source"?: string | null,"user_agent"?: string | null
                  }
                  Update: {
                    "action"?: string,"appointment_id"?: string | null,"business_id"?: string,"client_id"?: string | null,"created_at"?: string,"id"?: string,"ip_hash"?: string | null,"source"?: string | null,"user_agent"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "online_booking_log_appointment_id_fkey"
      columns: ["appointment_id"]
isOneToOne: false
      referencedRelation: "appointments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "online_booking_log_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "online_booking_log_client_id_fkey"
      columns: ["client_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["id"]
    }
                  ]
                },"online_booking_settings": {
                  Row: {
                    "accent_color": string | null,"allow_new_clients": boolean,"business_id": string,"cancel_cutoff_hours": number,"cancellation_policy": string,"consultation_service_id": string | null,"enabled": boolean,"notice_minutes": number,"updated_at": string,"welcome": string | null,"window_days": number
                  }
                  ComputedFields: never
                  Insert: {
                    "accent_color"?: string | null,"allow_new_clients"?: boolean,"business_id": string,"cancel_cutoff_hours"?: number,"cancellation_policy"?: string,"consultation_service_id"?: string | null,"enabled"?: boolean,"notice_minutes"?: number,"updated_at"?: string,"welcome"?: string | null,"window_days"?: number
                  }
                  Update: {
                    "accent_color"?: string | null,"allow_new_clients"?: boolean,"business_id"?: string,"cancel_cutoff_hours"?: number,"cancellation_policy"?: string,"consultation_service_id"?: string | null,"enabled"?: boolean,"notice_minutes"?: number,"updated_at"?: string,"welcome"?: string | null,"window_days"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "online_booking_settings_business_id_fkey"
      columns: ["business_id"]
isOneToOne: true
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "online_booking_settings_consultation_service_id_business_i_fkey"
      columns: ["consultation_service_id","business_id"]
isOneToOne: false
      referencedRelation: "services"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"online_verifications": {
                  Row: {
                    "attempts": number,"business_id": string,"channel": string,"code_hash": string,"created_at": string,"destination": string,"expires_at": string,"id": string,"link_hash": string | null,"session_hash": string | null,"verified_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "attempts"?: number,"business_id": string,"channel": string,"code_hash": string,"created_at"?: string,"destination": string,"expires_at": string,"id"?: string,"link_hash"?: string | null,"session_hash"?: string | null,"verified_at"?: string | null
                  }
                  Update: {
                    "attempts"?: number,"business_id"?: string,"channel"?: string,"code_hash"?: string,"created_at"?: string,"destination"?: string,"expires_at"?: string,"id"?: string,"link_hash"?: string | null,"session_hash"?: string | null,"verified_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "online_verifications_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    }
                  ]
                },"outbox_messages": {
                  Row: {
                    "body": string,"business_id": string | null,"channel": string,"created_at": string,"html": string | null,"id": string,"subject": string | null,"to_address": string
                  }
                  ComputedFields: never
                  Insert: {
                    "body": string,"business_id"?: string | null,"channel": string,"created_at"?: string,"html"?: string | null,"id"?: string,"subject"?: string | null,"to_address": string
                  }
                  Update: {
                    "body"?: string,"business_id"?: string | null,"channel"?: string,"created_at"?: string,"html"?: string | null,"id"?: string,"subject"?: string | null,"to_address"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "outbox_messages_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    }
                  ]
                },"package_events": {
                  Row: {
                    "amount_cents": number | null,"appointment_item_id": string | null,"business_id": string,"client_package_id": string,"created_at": string,"id": string,"kind": string,"quantity": number | null,"reason": string | null,"sale_id": string | null,"service_id": string | null,"staff_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_cents"?: number | null,"appointment_item_id"?: string | null,"business_id": string,"client_package_id": string,"created_at"?: string,"id"?: string,"kind": string,"quantity"?: number | null,"reason"?: string | null,"sale_id"?: string | null,"service_id"?: string | null,"staff_id"?: string | null
                  }
                  Update: {
                    "amount_cents"?: number | null,"appointment_item_id"?: string | null,"business_id"?: string,"client_package_id"?: string,"created_at"?: string,"id"?: string,"kind"?: string,"quantity"?: number | null,"reason"?: string | null,"sale_id"?: string | null,"service_id"?: string | null,"staff_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "package_events_appointment_item_id_fkey"
      columns: ["appointment_item_id"]
isOneToOne: false
      referencedRelation: "appointment_items"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "package_events_client_package_id_business_id_fkey"
      columns: ["client_package_id","business_id"]
isOneToOne: false
      referencedRelation: "client_packages"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "package_events_sale_id_fkey"
      columns: ["sale_id"]
isOneToOne: false
      referencedRelation: "sales"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "package_events_service_id_fkey"
      columns: ["service_id"]
isOneToOne: false
      referencedRelation: "services"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "package_events_staff_id_business_id_fkey"
      columns: ["staff_id","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"package_template_items": {
                  Row: {
                    "business_id": string,"quantity": number,"service_id": string,"template_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"quantity": number,"service_id": string,"template_id": string
                  }
                  Update: {
                    "business_id"?: string,"quantity"?: number,"service_id"?: string,"template_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "package_template_items_service_id_business_id_fkey"
      columns: ["service_id","business_id"]
isOneToOne: false
      referencedRelation: "services"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "package_template_items_template_id_business_id_fkey"
      columns: ["template_id","business_id"]
isOneToOne: false
      referencedRelation: "package_templates"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"package_templates": {
                  Row: {
                    "business_id": string,"created_at": string,"expiry_months": number | null,"id": string,"is_active": boolean,"levels": (Database["public"]['Enums']["staff_level"])[] | null,"name": string,"price_cents": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"created_at"?: string,"expiry_months"?: number | null,"id"?: string,"is_active"?: boolean,"levels"?: (Database["public"]['Enums']["staff_level"])[] | null,"name": string,"price_cents": number,"updated_at"?: string
                  }
                  Update: {
                    "business_id"?: string,"created_at"?: string,"expiry_months"?: number | null,"id"?: string,"is_active"?: boolean,"levels"?: (Database["public"]['Enums']["staff_level"])[] | null,"name"?: string,"price_cents"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "package_templates_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    }
                  ]
                },"payment_links": {
                  Row: {
                    "amount_cents": number,"business_id": string,"canceled_at": string | null,"channel": string,"client_id": string | null,"created_at": string,"created_by": string,"draft_id": string,"expires_at": string,"id": string,"location_id": string,"paid_at": string | null,"provider": string | null,"provider_reference": string | null,"sale_id": string | null,"sent_to": string,"snapshot": NonNullable<Json>,"status": string,"tip_cents": number | null,"token_hash": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_cents": number,"business_id": string,"canceled_at"?: string | null,"channel": string,"client_id"?: string | null,"created_at"?: string,"created_by": string,"draft_id": string,"expires_at": string,"id"?: string,"location_id": string,"paid_at"?: string | null,"provider"?: string | null,"provider_reference"?: string | null,"sale_id"?: string | null,"sent_to": string,"snapshot": NonNullable<Json>,"status"?: string,"tip_cents"?: number | null,"token_hash": string
                  }
                  Update: {
                    "amount_cents"?: number,"business_id"?: string,"canceled_at"?: string | null,"channel"?: string,"client_id"?: string | null,"created_at"?: string,"created_by"?: string,"draft_id"?: string,"expires_at"?: string,"id"?: string,"location_id"?: string,"paid_at"?: string | null,"provider"?: string | null,"provider_reference"?: string | null,"sale_id"?: string | null,"sent_to"?: string,"snapshot"?: NonNullable<Json>,"status"?: string,"tip_cents"?: number | null,"token_hash"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "payment_links_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payment_links_client_id_fkey"
      columns: ["client_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payment_links_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payment_links_draft_id_fkey"
      columns: ["draft_id"]
isOneToOne: false
      referencedRelation: "sale_drafts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payment_links_location_id_fkey"
      columns: ["location_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payment_links_sale_id_fkey"
      columns: ["sale_id"]
isOneToOne: false
      referencedRelation: "sales"
      referencedColumns: ["id"]
    }
                  ]
                },"payments": {
                  Row: {
                    "amount_cents": number,"business_id": string,"change_cents": number | null,"created_at": string,"created_by": string | null,"gift_card_id": string | null,"id": string,"location_id": string,"method": Database["public"]['Enums']["payment_method"],"package_item_id": string | null,"processor": string | null,"processor_reference": string | null,"provider_refund": string | null,"reason": string | null,"reference": string | null,"sale_id": string,"tendered_cents": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_cents": number,"business_id": string,"change_cents"?: number | null,"created_at"?: string,"created_by"?: string | null,"gift_card_id"?: string | null,"id"?: string,"location_id": string,"method": Database["public"]['Enums']["payment_method"],"package_item_id"?: string | null,"processor"?: string | null,"processor_reference"?: string | null,"provider_refund"?: string | null,"reason"?: string | null,"reference"?: string | null,"sale_id": string,"tendered_cents"?: number | null
                  }
                  Update: {
                    "amount_cents"?: number,"business_id"?: string,"change_cents"?: number | null,"created_at"?: string,"created_by"?: string | null,"gift_card_id"?: string | null,"id"?: string,"location_id"?: string,"method"?: Database["public"]['Enums']["payment_method"],"package_item_id"?: string | null,"processor"?: string | null,"processor_reference"?: string | null,"provider_refund"?: string | null,"reason"?: string | null,"reference"?: string | null,"sale_id"?: string,"tendered_cents"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "payments_created_by_business_id_fkey"
      columns: ["created_by","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "payments_gift_card_id_fkey"
      columns: ["gift_card_id"]
isOneToOne: false
      referencedRelation: "gift_cards"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payments_package_item_id_fkey"
      columns: ["package_item_id"]
isOneToOne: false
      referencedRelation: "client_package_items"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payments_sale_id_business_id_fkey"
      columns: ["sale_id","business_id"]
isOneToOne: false
      referencedRelation: "sales"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"policy_consents": {
                  Row: {
                    "agreed_at": string,"appointment_id": string | null,"business_id": string,"channel": string,"client_id": string,"id": string,"ip_hash": string | null,"policy_text": string,"terms": NonNullable<Json>
                  }
                  ComputedFields: never
                  Insert: {
                    "agreed_at"?: string,"appointment_id"?: string | null,"business_id": string,"channel": string,"client_id": string,"id"?: string,"ip_hash"?: string | null,"policy_text": string,"terms": NonNullable<Json>
                  }
                  Update: {
                    "agreed_at"?: string,"appointment_id"?: string | null,"business_id"?: string,"channel"?: string,"client_id"?: string,"id"?: string,"ip_hash"?: string | null,"policy_text"?: string,"terms"?: NonNullable<Json>
                  }
                  Relationships: [
                    {
      foreignKeyName: "policy_consents_appointment_id_fkey"
      columns: ["appointment_id"]
isOneToOne: false
      referencedRelation: "appointments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "policy_consents_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "policy_consents_client_id_business_id_fkey"
      columns: ["client_id","business_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"policy_fee_events": {
                  Row: {
                    "amount_cents": number | null,"business_id": string,"created_at": string,"detail": string | null,"fee_id": string,"id": string,"kind": string,"staff_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_cents"?: number | null,"business_id": string,"created_at"?: string,"detail"?: string | null,"fee_id": string,"id"?: string,"kind": string,"staff_id"?: string | null
                  }
                  Update: {
                    "amount_cents"?: number | null,"business_id"?: string,"created_at"?: string,"detail"?: string | null,"fee_id"?: string,"id"?: string,"kind"?: string,"staff_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "policy_fee_events_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "policy_fee_events_fee_id_fkey"
      columns: ["fee_id"]
isOneToOne: false
      referencedRelation: "policy_fees"
      referencedColumns: ["id"]
    }
                  ]
                },"policy_fees": {
                  Row: {
                    "appointment_id": string,"attempts": number,"business_id": string,"card_label": string | null,"charge_after": string | null,"charged_at": string | null,"client_id": string,"created_at": string,"failure_reason": string | null,"fee_cents": number,"from_deposit_cents": number,"id": string,"kind": string,"location_id": string,"provider": string | null,"provider_reference": string | null,"receipt_sent_at": string | null,"refund_due": boolean,"refunded_at": string | null,"status": string,"updated_at": string,"waive_reason": string | null,"waived_at": string | null,"waived_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "appointment_id": string,"attempts"?: number,"business_id": string,"card_label"?: string | null,"charge_after"?: string | null,"charged_at"?: string | null,"client_id": string,"created_at"?: string,"failure_reason"?: string | null,"fee_cents": number,"from_deposit_cents"?: number,"id"?: string,"kind": string,"location_id": string,"provider"?: string | null,"provider_reference"?: string | null,"receipt_sent_at"?: string | null,"refund_due"?: boolean,"refunded_at"?: string | null,"status": string,"updated_at"?: string,"waive_reason"?: string | null,"waived_at"?: string | null,"waived_by"?: string | null
                  }
                  Update: {
                    "appointment_id"?: string,"attempts"?: number,"business_id"?: string,"card_label"?: string | null,"charge_after"?: string | null,"charged_at"?: string | null,"client_id"?: string,"created_at"?: string,"failure_reason"?: string | null,"fee_cents"?: number,"from_deposit_cents"?: number,"id"?: string,"kind"?: string,"location_id"?: string,"provider"?: string | null,"provider_reference"?: string | null,"receipt_sent_at"?: string | null,"refund_due"?: boolean,"refunded_at"?: string | null,"status"?: string,"updated_at"?: string,"waive_reason"?: string | null,"waived_at"?: string | null,"waived_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "policy_fees_appointment_id_fkey"
      columns: ["appointment_id"]
isOneToOne: false
      referencedRelation: "appointments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "policy_fees_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "policy_fees_client_id_business_id_fkey"
      columns: ["client_id","business_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "policy_fees_location_id_fkey"
      columns: ["location_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id"]
    }
                  ]
                },"policy_settings": {
                  Row: {
                    "business_id": string,"cancel_window_hours": number,"card_required": string,"card_service_ids": (string)[],"card_staff_ids": (string)[],"late_cancel_fee_amount": number,"late_cancel_fee_kind": Database["public"]['Enums']["fee_kind"],"long_hold_days": number | null,"no_show_fee_amount": number,"no_show_fee_kind": Database["public"]['Enums']["fee_kind"],"repeat_action": string,"repeat_count": number,"repeat_deposit_percent": number,"repeat_months": number,"updated_at": string,"updated_by": string | null,"waive_roles": (Database["public"]['Enums']["staff_role"])[]
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"cancel_window_hours"?: number,"card_required"?: string,"card_service_ids"?: (string)[],"card_staff_ids"?: (string)[],"late_cancel_fee_amount"?: number,"late_cancel_fee_kind"?: Database["public"]['Enums']["fee_kind"],"long_hold_days"?: number | null,"no_show_fee_amount"?: number,"no_show_fee_kind"?: Database["public"]['Enums']["fee_kind"],"repeat_action"?: string,"repeat_count"?: number,"repeat_deposit_percent"?: number,"repeat_months"?: number,"updated_at"?: string,"updated_by"?: string | null,"waive_roles"?: (Database["public"]['Enums']["staff_role"])[]
                  }
                  Update: {
                    "business_id"?: string,"cancel_window_hours"?: number,"card_required"?: string,"card_service_ids"?: (string)[],"card_staff_ids"?: (string)[],"late_cancel_fee_amount"?: number,"late_cancel_fee_kind"?: Database["public"]['Enums']["fee_kind"],"long_hold_days"?: number | null,"no_show_fee_amount"?: number,"no_show_fee_kind"?: Database["public"]['Enums']["fee_kind"],"repeat_action"?: string,"repeat_count"?: number,"repeat_deposit_percent"?: number,"repeat_months"?: number,"updated_at"?: string,"updated_by"?: string | null,"waive_roles"?: (Database["public"]['Enums']["staff_role"])[]
                  }
                  Relationships: [
                    {
      foreignKeyName: "policy_settings_business_id_fkey"
      columns: ["business_id"]
isOneToOne: true
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    }
                  ]
                },"products": {
                  Row: {
                    "barcode": string | null,"brand": string,"business_id": string,"cost_cents": number,"created_at": string,"id": string,"is_active": boolean,"line": string | null,"name": string,"price_cents": number | null,"shelf": string | null,"size": number,"sku": string | null,"supplier_id": string | null,"type": Database["public"]['Enums']["product_type"],"unit": Database["public"]['Enums']["product_unit"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "barcode"?: string | null,"brand": string,"business_id": string,"cost_cents"?: number,"created_at"?: string,"id"?: string,"is_active"?: boolean,"line"?: string | null,"name": string,"price_cents"?: number | null,"shelf"?: string | null,"size": number,"sku"?: string | null,"supplier_id"?: string | null,"type": Database["public"]['Enums']["product_type"],"unit": Database["public"]['Enums']["product_unit"],"updated_at"?: string
                  }
                  Update: {
                    "barcode"?: string | null,"brand"?: string,"business_id"?: string,"cost_cents"?: number,"created_at"?: string,"id"?: string,"is_active"?: boolean,"line"?: string | null,"name"?: string,"price_cents"?: number | null,"shelf"?: string | null,"size"?: number,"sku"?: string | null,"supplier_id"?: string | null,"type"?: Database["public"]['Enums']["product_type"],"unit"?: Database["public"]['Enums']["product_unit"],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "products_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "products_supplier_id_business_id_fkey"
      columns: ["supplier_id","business_id"]
isOneToOne: false
      referencedRelation: "suppliers"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"promotion_redemptions": {
                  Row: {
                    "applied_by": string | null,"appointment_id": string | null,"business_id": string,"client_id": string | null,"created_at": string,"discount_cents": number,"first_visit": boolean,"id": string,"last_minute": boolean,"promotion_id": string,"sale_id": string,"source": string,"voided_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "applied_by"?: string | null,"appointment_id"?: string | null,"business_id": string,"client_id"?: string | null,"created_at"?: string,"discount_cents": number,"first_visit"?: boolean,"id"?: string,"last_minute"?: boolean,"promotion_id": string,"sale_id": string,"source": string,"voided_at"?: string | null
                  }
                  Update: {
                    "applied_by"?: string | null,"appointment_id"?: string | null,"business_id"?: string,"client_id"?: string | null,"created_at"?: string,"discount_cents"?: number,"first_visit"?: boolean,"id"?: string,"last_minute"?: boolean,"promotion_id"?: string,"sale_id"?: string,"source"?: string,"voided_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "promotion_redemptions_applied_by_fkey"
      columns: ["applied_by"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "promotion_redemptions_appointment_id_fkey"
      columns: ["appointment_id"]
isOneToOne: false
      referencedRelation: "appointments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "promotion_redemptions_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "promotion_redemptions_client_id_fkey"
      columns: ["client_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "promotion_redemptions_promotion_id_fkey"
      columns: ["promotion_id"]
isOneToOne: false
      referencedRelation: "promotions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "promotion_redemptions_sale_id_fkey"
      columns: ["sale_id"]
isOneToOne: false
      referencedRelation: "sales"
      referencedColumns: ["id"]
    }
                  ]
                },"promotions": {
                  Row: {
                    "amount_cents": number | null,"applies_retail": boolean,"applies_services": boolean,"archived_at": string | null,"business_id": string,"categories": (string)[] | null,"code": string | null,"created_at": string,"created_by": string | null,"discount_kind": string,"ends_on": string | null,"exclusions": NonNullable<Json>,"first_visit_only": boolean,"hours_ahead": number | null,"id": string,"kind": string,"levels": (Database["public"]['Enums']["staff_level"])[] | null,"max_uses": number | null,"max_uses_per_client": number | null,"min_spend_cents": number | null,"name": string,"new_clients_only": boolean,"online": boolean,"percent": number | null,"product_ids": (string)[] | null,"service_ids": (string)[] | null,"stackable": boolean,"staff_ids": (string)[] | null,"starts_on": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_cents"?: number | null,"applies_retail"?: boolean,"applies_services"?: boolean,"archived_at"?: string | null,"business_id": string,"categories"?: (string)[] | null,"code"?: string | null,"created_at"?: string,"created_by"?: string | null,"discount_kind": string,"ends_on"?: string | null,"exclusions"?: NonNullable<Json>,"first_visit_only"?: boolean,"hours_ahead"?: number | null,"id"?: string,"kind": string,"levels"?: (Database["public"]['Enums']["staff_level"])[] | null,"max_uses"?: number | null,"max_uses_per_client"?: number | null,"min_spend_cents"?: number | null,"name": string,"new_clients_only"?: boolean,"online"?: boolean,"percent"?: number | null,"product_ids"?: (string)[] | null,"service_ids"?: (string)[] | null,"stackable"?: boolean,"staff_ids"?: (string)[] | null,"starts_on"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "amount_cents"?: number | null,"applies_retail"?: boolean,"applies_services"?: boolean,"archived_at"?: string | null,"business_id"?: string,"categories"?: (string)[] | null,"code"?: string | null,"created_at"?: string,"created_by"?: string | null,"discount_kind"?: string,"ends_on"?: string | null,"exclusions"?: NonNullable<Json>,"first_visit_only"?: boolean,"hours_ahead"?: number | null,"id"?: string,"kind"?: string,"levels"?: (Database["public"]['Enums']["staff_level"])[] | null,"max_uses"?: number | null,"max_uses_per_client"?: number | null,"min_spend_cents"?: number | null,"name"?: string,"new_clients_only"?: boolean,"online"?: boolean,"percent"?: number | null,"product_ids"?: (string)[] | null,"service_ids"?: (string)[] | null,"stackable"?: boolean,"staff_ids"?: (string)[] | null,"starts_on"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "promotions_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "promotions_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id"]
    }
                  ]
                },"purchase_order_lines": {
                  Row: {
                    "business_id": string,"id": string,"product_id": string,"purchase_order_id": string,"quantity": number,"reason": string | null,"received_quantity": number,"unit_cost_cents": number
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"id"?: string,"product_id": string,"purchase_order_id": string,"quantity": number,"reason"?: string | null,"received_quantity"?: number,"unit_cost_cents": number
                  }
                  Update: {
                    "business_id"?: string,"id"?: string,"product_id"?: string,"purchase_order_id"?: string,"quantity"?: number,"reason"?: string | null,"received_quantity"?: number,"unit_cost_cents"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "purchase_order_lines_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "purchase_order_lines_product_id_business_id_fkey"
      columns: ["product_id","business_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "purchase_order_lines_purchase_order_id_business_id_fkey"
      columns: ["purchase_order_id","business_id"]
isOneToOne: false
      referencedRelation: "purchase_orders"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"purchase_orders": {
                  Row: {
                    "ai_action_id": string | null,"business_id": string,"created_at": string,"created_by": string | null,"id": string,"location_id": string,"notes": string | null,"number": number,"received_at": string | null,"sent_at": string | null,"sent_by": string | null,"status": Database["public"]['Enums']["purchase_order_status"],"supplier_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "ai_action_id"?: string | null,"business_id": string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"location_id": string,"notes"?: string | null,"number"?: never,"received_at"?: string | null,"sent_at"?: string | null,"sent_by"?: string | null,"status"?: Database["public"]['Enums']["purchase_order_status"],"supplier_id": string,"updated_at"?: string
                  }
                  Update: {
                    "ai_action_id"?: string | null,"business_id"?: string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"location_id"?: string,"notes"?: string | null,"number"?: never,"received_at"?: string | null,"sent_at"?: string | null,"sent_by"?: string | null,"status"?: Database["public"]['Enums']["purchase_order_status"],"supplier_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "purchase_orders_ai_action_id_fkey"
      columns: ["ai_action_id"]
isOneToOne: false
      referencedRelation: "ai_actions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "purchase_orders_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "purchase_orders_created_by_business_id_fkey"
      columns: ["created_by","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "purchase_orders_location_id_business_id_fkey"
      columns: ["location_id","business_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "purchase_orders_sent_by_business_id_fkey"
      columns: ["sent_by","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "purchase_orders_supplier_id_business_id_fkey"
      columns: ["supplier_id","business_id"]
isOneToOne: false
      referencedRelation: "suppliers"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"rate_limits": {
                  Row: {
                    "hits": number,"key": string,"window_start": string
                  }
                  ComputedFields: never
                  Insert: {
                    "hits"?: number,"key": string,"window_start": string
                  }
                  Update: {
                    "hits"?: number,"key"?: string,"window_start"?: string
                  }
                  Relationships: [
                    
                  ]
                },"resources": {
                  Row: {
                    "business_id": string,"created_at": string,"id": string,"is_active": boolean,"kind": Database["public"]['Enums']["resource_kind"],"location_id": string,"name": string,"sort_order": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"created_at"?: string,"id"?: string,"is_active"?: boolean,"kind": Database["public"]['Enums']["resource_kind"],"location_id": string,"name": string,"sort_order"?: number,"updated_at"?: string
                  }
                  Update: {
                    "business_id"?: string,"created_at"?: string,"id"?: string,"is_active"?: boolean,"kind"?: Database["public"]['Enums']["resource_kind"],"location_id"?: string,"name"?: string,"sort_order"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "resources_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "resources_location_id_business_id_fkey"
      columns: ["location_id","business_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"sale_drafts": {
                  Row: {
                    "appointment_id": string | null,"business_id": string,"client_id": string | null,"created_at": string,"created_by": string | null,"id": string,"location_id": string,"return_to": string | null,"sale_id": string | null,"status": string,"ticket": NonNullable<Json>,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "appointment_id"?: string | null,"business_id": string,"client_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"location_id": string,"return_to"?: string | null,"sale_id"?: string | null,"status"?: string,"ticket"?: NonNullable<Json>,"updated_at"?: string
                  }
                  Update: {
                    "appointment_id"?: string | null,"business_id"?: string,"client_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"location_id"?: string,"return_to"?: string | null,"sale_id"?: string | null,"status"?: string,"ticket"?: NonNullable<Json>,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "sale_drafts_appointment_id_business_id_fkey"
      columns: ["appointment_id","business_id"]
isOneToOne: false
      referencedRelation: "appointments"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "sale_drafts_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sale_drafts_client_id_business_id_fkey"
      columns: ["client_id","business_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "sale_drafts_created_by_business_id_fkey"
      columns: ["created_by","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "sale_drafts_location_id_business_id_fkey"
      columns: ["location_id","business_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "sale_drafts_sale_id_business_id_fkey"
      columns: ["sale_id","business_id"]
isOneToOne: false
      referencedRelation: "sales"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"sale_events": {
                  Row: {
                    "amount_cents": number | null,"business_id": string,"created_at": string,"detail": string | null,"id": string,"kind": string,"returned": NonNullable<Json>,"sale_id": string,"staff_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_cents"?: number | null,"business_id": string,"created_at"?: string,"detail"?: string | null,"id"?: string,"kind": string,"returned"?: NonNullable<Json>,"sale_id": string,"staff_id"?: string | null
                  }
                  Update: {
                    "amount_cents"?: number | null,"business_id"?: string,"created_at"?: string,"detail"?: string | null,"id"?: string,"kind"?: string,"returned"?: NonNullable<Json>,"sale_id"?: string,"staff_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "sale_events_sale_id_business_id_fkey"
      columns: ["sale_id","business_id"]
isOneToOne: false
      referencedRelation: "sales"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "sale_events_staff_id_business_id_fkey"
      columns: ["staff_id","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"sale_items": {
                  Row: {
                    "appointment_item_id": string | null,"booked_price_cents": number | null,"business_id": string,"client_package_id": string | null,"commission_pct": number | null,"commission_version_id": string | null,"description": string,"discount_cents": number,"gift_card_id": string | null,"id": string,"kind": Database["public"]['Enums']["sale_item_kind"],"line_discount_cents": number,"line_discount_reason": string | null,"member_discount_cents": number,"membership_credit_id": string | null,"membership_id": string | null,"package_item_id": string | null,"position": number,"price_reason": string | null,"product_id": string | null,"promo_discount_cents": number,"quantity": number,"returned_quantity": number,"sale_id": string,"service_id": string | null,"staff_id": string | null,"tax_cents": number,"total_cents": number,"unit_price_cents": number
                  }
                  ComputedFields: never
                  Insert: {
                    "appointment_item_id"?: string | null,"booked_price_cents"?: number | null,"business_id": string,"client_package_id"?: string | null,"commission_pct"?: number | null,"commission_version_id"?: string | null,"description": string,"discount_cents"?: number,"gift_card_id"?: string | null,"id"?: string,"kind": Database["public"]['Enums']["sale_item_kind"],"line_discount_cents"?: number,"line_discount_reason"?: string | null,"member_discount_cents"?: number,"membership_credit_id"?: string | null,"membership_id"?: string | null,"package_item_id"?: string | null,"position": number,"price_reason"?: string | null,"product_id"?: string | null,"promo_discount_cents"?: number,"quantity"?: number,"returned_quantity"?: number,"sale_id": string,"service_id"?: string | null,"staff_id"?: string | null,"tax_cents"?: number,"total_cents": number,"unit_price_cents": number
                  }
                  Update: {
                    "appointment_item_id"?: string | null,"booked_price_cents"?: number | null,"business_id"?: string,"client_package_id"?: string | null,"commission_pct"?: number | null,"commission_version_id"?: string | null,"description"?: string,"discount_cents"?: number,"gift_card_id"?: string | null,"id"?: string,"kind"?: Database["public"]['Enums']["sale_item_kind"],"line_discount_cents"?: number,"line_discount_reason"?: string | null,"member_discount_cents"?: number,"membership_credit_id"?: string | null,"membership_id"?: string | null,"package_item_id"?: string | null,"position"?: number,"price_reason"?: string | null,"product_id"?: string | null,"promo_discount_cents"?: number,"quantity"?: number,"returned_quantity"?: number,"sale_id"?: string,"service_id"?: string | null,"staff_id"?: string | null,"tax_cents"?: number,"total_cents"?: number,"unit_price_cents"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "sale_items_appointment_item_id_fkey"
      columns: ["appointment_item_id"]
isOneToOne: false
      referencedRelation: "appointment_items"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sale_items_client_package_id_fkey"
      columns: ["client_package_id"]
isOneToOne: false
      referencedRelation: "client_packages"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sale_items_commission_version_id_fkey"
      columns: ["commission_version_id"]
isOneToOne: false
      referencedRelation: "commission_plan_versions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sale_items_gift_card_id_fkey"
      columns: ["gift_card_id"]
isOneToOne: false
      referencedRelation: "gift_cards"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sale_items_membership_credit_id_fkey"
      columns: ["membership_credit_id"]
isOneToOne: false
      referencedRelation: "membership_credits"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sale_items_membership_id_fkey"
      columns: ["membership_id"]
isOneToOne: false
      referencedRelation: "client_memberships"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sale_items_package_item_id_fkey"
      columns: ["package_item_id"]
isOneToOne: false
      referencedRelation: "client_package_items"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sale_items_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sale_items_sale_id_business_id_fkey"
      columns: ["sale_id","business_id"]
isOneToOne: false
      referencedRelation: "sales"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "sale_items_service_id_fkey"
      columns: ["service_id"]
isOneToOne: false
      referencedRelation: "services"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sale_items_staff_id_business_id_fkey"
      columns: ["staff_id","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"sale_tips": {
                  Row: {
                    "amount_cents": number,"business_id": string,"sale_id": string,"staff_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_cents": number,"business_id": string,"sale_id": string,"staff_id": string
                  }
                  Update: {
                    "amount_cents"?: number,"business_id"?: string,"sale_id"?: string,"staff_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "sale_tips_sale_id_business_id_fkey"
      columns: ["sale_id","business_id"]
isOneToOne: false
      referencedRelation: "sales"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "sale_tips_staff_id_business_id_fkey"
      columns: ["staff_id","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"sales": {
                  Row: {
                    "appointment_id": string | null,"business_id": string,"client_id": string | null,"created_at": string,"created_by": string | null,"discount_cents": number,"discount_reason": string | null,"draft_id": string | null,"id": string,"location_id": string,"note": string | null,"number": number,"rebook_appointment_id": string | null,"receipt_email": string | null,"refunded_cents": number,"status": Database["public"]['Enums']["sale_status"],"subtotal_cents": number,"tax_cents": number,"tip_cents": number,"total_cents": number,"void_reason": string | null,"voided_at": string | null,"voided_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "appointment_id"?: string | null,"business_id": string,"client_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"discount_cents"?: number,"discount_reason"?: string | null,"draft_id"?: string | null,"id"?: string,"location_id": string,"note"?: string | null,"number": number,"rebook_appointment_id"?: string | null,"receipt_email"?: string | null,"refunded_cents"?: number,"status"?: Database["public"]['Enums']["sale_status"],"subtotal_cents": number,"tax_cents"?: number,"tip_cents"?: number,"total_cents": number,"void_reason"?: string | null,"voided_at"?: string | null,"voided_by"?: string | null
                  }
                  Update: {
                    "appointment_id"?: string | null,"business_id"?: string,"client_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"discount_cents"?: number,"discount_reason"?: string | null,"draft_id"?: string | null,"id"?: string,"location_id"?: string,"note"?: string | null,"number"?: number,"rebook_appointment_id"?: string | null,"receipt_email"?: string | null,"refunded_cents"?: number,"status"?: Database["public"]['Enums']["sale_status"],"subtotal_cents"?: number,"tax_cents"?: number,"tip_cents"?: number,"total_cents"?: number,"void_reason"?: string | null,"voided_at"?: string | null,"voided_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "sales_appointment_id_fkey"
      columns: ["appointment_id"]
isOneToOne: false
      referencedRelation: "appointments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sales_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sales_client_id_fkey"
      columns: ["client_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sales_created_by_business_id_fkey"
      columns: ["created_by","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "sales_draft_id_fkey"
      columns: ["draft_id"]
isOneToOne: false
      referencedRelation: "sale_drafts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sales_location_id_business_id_fkey"
      columns: ["location_id","business_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "sales_rebook_appointment_id_fkey"
      columns: ["rebook_appointment_id"]
isOneToOne: false
      referencedRelation: "appointments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sales_voided_by_business_id_fkey"
      columns: ["voided_by","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"schedule_disruptions": {
                  Row: {
                    "appointment_id": string | null,"business_id": string,"created_at": string,"id": string,"item_id": string | null,"kind": Database["public"]['Enums']["disruption_kind"],"location_id": string,"minutes": number | null,"on_date": string,"reported_by": string | null,"resolved_by_action": string | null,"staff_id": string | null,"starts_at": string | null,"time_off_id": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "appointment_id"?: string | null,"business_id": string,"created_at"?: string,"id"?: string,"item_id"?: string | null,"kind": Database["public"]['Enums']["disruption_kind"],"location_id": string,"minutes"?: number | null,"on_date": string,"reported_by"?: string | null,"resolved_by_action"?: string | null,"staff_id"?: string | null,"starts_at"?: string | null,"time_off_id"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "appointment_id"?: string | null,"business_id"?: string,"created_at"?: string,"id"?: string,"item_id"?: string | null,"kind"?: Database["public"]['Enums']["disruption_kind"],"location_id"?: string,"minutes"?: number | null,"on_date"?: string,"reported_by"?: string | null,"resolved_by_action"?: string | null,"staff_id"?: string | null,"starts_at"?: string | null,"time_off_id"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "schedule_disruptions_appointment_id_business_id_location_i_fkey"
      columns: ["appointment_id","business_id","location_id"]
isOneToOne: false
      referencedRelation: "appointments"
      referencedColumns: ["id","business_id","location_id"]
    },{
      foreignKeyName: "schedule_disruptions_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "schedule_disruptions_item_id_fkey"
      columns: ["item_id"]
isOneToOne: false
      referencedRelation: "appointment_items"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "schedule_disruptions_location_id_business_id_fkey"
      columns: ["location_id","business_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "schedule_disruptions_reported_by_business_id_fkey"
      columns: ["reported_by","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "schedule_disruptions_resolved_by_action_fkey"
      columns: ["resolved_by_action"]
isOneToOne: false
      referencedRelation: "ai_actions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "schedule_disruptions_staff_id_business_id_fkey"
      columns: ["staff_id","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "schedule_disruptions_time_off_id_fkey"
      columns: ["time_off_id"]
isOneToOne: false
      referencedRelation: "staff_time_off"
      referencedColumns: ["id"]
    }
                  ]
                },"service_level_prices": {
                  Row: {
                    "business_id": string,"level": Database["public"]['Enums']["staff_level"],"price_cents": number,"service_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"level": Database["public"]['Enums']["staff_level"],"price_cents": number,"service_id": string
                  }
                  Update: {
                    "business_id"?: string,"level"?: Database["public"]['Enums']["staff_level"],"price_cents"?: number,"service_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "service_level_prices_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "service_level_prices_service_id_business_id_fkey"
      columns: ["service_id","business_id"]
isOneToOne: false
      referencedRelation: "services"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"service_products": {
                  Row: {
                    "amount": number,"business_id": string,"id": string,"product_id": string,"service_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"business_id": string,"id"?: string,"product_id": string,"service_id": string
                  }
                  Update: {
                    "amount"?: number,"business_id"?: string,"id"?: string,"product_id"?: string,"service_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "service_products_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "service_products_product_id_business_id_fkey"
      columns: ["product_id","business_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "service_products_service_id_business_id_fkey"
      columns: ["service_id","business_id"]
isOneToOne: false
      referencedRelation: "services"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"services": {
                  Row: {
                    "active_minutes": number,"archived_at": string | null,"business_id": string,"category": string,"created_at": string,"deposit_amount": number,"deposit_kind": Database["public"]['Enums']["deposit_kind"],"description": string | null,"duration_minutes": number | null,"finishing_minutes": number,"id": string,"name": string,"online_booking": Database["public"]['Enums']["online_service_mode"],"price_cents": number,"processing_minutes": number,"requires_patch_test": boolean,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "active_minutes": number,"archived_at"?: string | null,"business_id": string,"category": string,"created_at"?: string,"deposit_amount"?: number,"deposit_kind"?: Database["public"]['Enums']["deposit_kind"],"description"?: string | null,"duration_minutes"?: never,"finishing_minutes"?: number,"id"?: string,"name": string,"online_booking"?: Database["public"]['Enums']["online_service_mode"],"price_cents": number,"processing_minutes"?: number,"requires_patch_test"?: boolean,"updated_at"?: string
                  }
                  Update: {
                    "active_minutes"?: number,"archived_at"?: string | null,"business_id"?: string,"category"?: string,"created_at"?: string,"deposit_amount"?: number,"deposit_kind"?: Database["public"]['Enums']["deposit_kind"],"description"?: string | null,"duration_minutes"?: never,"finishing_minutes"?: number,"id"?: string,"name"?: string,"online_booking"?: Database["public"]['Enums']["online_service_mode"],"price_cents"?: number,"processing_minutes"?: number,"requires_patch_test"?: boolean,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "services_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    }
                  ]
                },"shared_devices": {
                  Row: {
                    "business_id": string,"created_at": string,"created_by": string | null,"id": string,"last_used_at": string | null,"location_id": string,"name": string,"revoked_at": string | null,"token_hash": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"last_used_at"?: string | null,"location_id": string,"name": string,"revoked_at"?: string | null,"token_hash": string
                  }
                  Update: {
                    "business_id"?: string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"last_used_at"?: string | null,"location_id"?: string,"name"?: string,"revoked_at"?: string | null,"token_hash"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "shared_devices_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "shared_devices_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "shared_devices_location_id_fkey"
      columns: ["location_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id"]
    }
                  ]
                },"sms_suppressions": {
                  Row: {
                    "keyword": string,"phone_digits": string,"stopped_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "keyword": string,"phone_digits": string,"stopped_at"?: string
                  }
                  Update: {
                    "keyword"?: string,"phone_digits"?: string,"stopped_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"staff": {
                  Row: {
                    "assists_staff_id": string | null,"business_id": string,"calendar_position": number | null,"calendar_zoom": string,"color": string | null,"created_at": string,"email": string | null,"event_roles": (string)[],"first_name": string,"goal_alert_seen_on": string | null,"goal_alerts": string,"id": string,"is_active": boolean,"last_name": string,"level": Database["public"]['Enums']["staff_level"] | null,"location_id": string,"phone": string | null,"photo_path": string | null,"role": Database["public"]['Enums']["staff_role"],"updated_at": string,"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "assists_staff_id"?: string | null,"business_id": string,"calendar_position"?: number | null,"calendar_zoom"?: string,"color"?: string | null,"created_at"?: string,"email"?: string | null,"event_roles"?: (string)[],"first_name": string,"goal_alert_seen_on"?: string | null,"goal_alerts"?: string,"id"?: string,"is_active"?: boolean,"last_name"?: string,"level"?: Database["public"]['Enums']["staff_level"] | null,"location_id": string,"phone"?: string | null,"photo_path"?: string | null,"role"?: Database["public"]['Enums']["staff_role"],"updated_at"?: string,"user_id"?: string | null
                  }
                  Update: {
                    "assists_staff_id"?: string | null,"business_id"?: string,"calendar_position"?: number | null,"calendar_zoom"?: string,"color"?: string | null,"created_at"?: string,"email"?: string | null,"event_roles"?: (string)[],"first_name"?: string,"goal_alert_seen_on"?: string | null,"goal_alerts"?: string,"id"?: string,"is_active"?: boolean,"last_name"?: string,"level"?: Database["public"]['Enums']["staff_level"] | null,"location_id"?: string,"phone"?: string | null,"photo_path"?: string | null,"role"?: Database["public"]['Enums']["staff_role"],"updated_at"?: string,"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "staff_assists_staff_id_fkey"
      columns: ["assists_staff_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "staff_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "staff_location_id_business_id_fkey"
      columns: ["location_id","business_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"staff_compensation": {
                  Row: {
                    "business_id": string,"hourly_rate_cents": number | null,"plan_id": string | null,"retail_commission_pct": number,"service_commission_pct": number,"staff_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"hourly_rate_cents"?: number | null,"plan_id"?: string | null,"retail_commission_pct"?: number,"service_commission_pct"?: number,"staff_id": string,"updated_at"?: string
                  }
                  Update: {
                    "business_id"?: string,"hourly_rate_cents"?: number | null,"plan_id"?: string | null,"retail_commission_pct"?: number,"service_commission_pct"?: number,"staff_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "staff_compensation_plan_id_business_id_fkey"
      columns: ["plan_id","business_id"]
isOneToOne: false
      referencedRelation: "commission_plans"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "staff_compensation_staff_id_business_id_fkey"
      columns: ["staff_id","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"staff_compensation_history": {
                  Row: {
                    "business_id": string,"changed_by": string | null,"created_at": string,"effective_from": string,"hourly_rate_cents": number | null,"id": string,"plan_id": string | null,"retail_commission_pct": number,"service_commission_pct": number,"staff_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"changed_by"?: string | null,"created_at"?: string,"effective_from": string,"hourly_rate_cents"?: number | null,"id"?: string,"plan_id"?: string | null,"retail_commission_pct": number,"service_commission_pct": number,"staff_id": string
                  }
                  Update: {
                    "business_id"?: string,"changed_by"?: string | null,"created_at"?: string,"effective_from"?: string,"hourly_rate_cents"?: number | null,"id"?: string,"plan_id"?: string | null,"retail_commission_pct"?: number,"service_commission_pct"?: number,"staff_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "staff_compensation_history_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "staff_compensation_history_changed_by_fkey"
      columns: ["changed_by"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "staff_compensation_history_plan_id_fkey"
      columns: ["plan_id"]
isOneToOne: false
      referencedRelation: "commission_plans"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "staff_compensation_history_staff_id_fkey"
      columns: ["staff_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id"]
    }
                  ]
                },"staff_goals": {
                  Row: {
                    "business_id": string,"created_at": string,"created_by": string | null,"id": string,"metric": string,"period": string,"set_by_owner": boolean,"staff_id": string,"target": number,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"metric": string,"period": string,"set_by_owner"?: boolean,"staff_id": string,"target": number,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "business_id"?: string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"metric"?: string,"period"?: string,"set_by_owner"?: boolean,"staff_id"?: string,"target"?: number,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "staff_goals_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "staff_goals_staff_id_business_id_fkey"
      columns: ["staff_id","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"staff_permissions": {
                  Row: {
                    "allowed": boolean,"business_id": string,"permission": string,"staff_id": string,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "allowed": boolean,"business_id": string,"permission": string,"staff_id": string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "allowed"?: boolean,"business_id"?: string,"permission"?: string,"staff_id"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "staff_permissions_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "staff_permissions_staff_id_fkey"
      columns: ["staff_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "staff_permissions_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id"]
    }
                  ]
                },"staff_pins": {
                  Row: {
                    "business_id": string,"failed_attempts": number,"locked_until": string | null,"pin_hash": string,"staff_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"failed_attempts"?: number,"locked_until"?: string | null,"pin_hash": string,"staff_id": string,"updated_at"?: string
                  }
                  Update: {
                    "business_id"?: string,"failed_attempts"?: number,"locked_until"?: string | null,"pin_hash"?: string,"staff_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "staff_pins_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "staff_pins_staff_id_fkey"
      columns: ["staff_id"]
isOneToOne: true
      referencedRelation: "staff"
      referencedColumns: ["id"]
    }
                  ]
                },"staff_policies": {
                  Row: {
                    "business_id": string,"cancel_window_hours": number | null,"late_cancel_fee_amount": number | null,"late_cancel_fee_kind": Database["public"]['Enums']["fee_kind"] | null,"no_show_fee_amount": number | null,"no_show_fee_kind": Database["public"]['Enums']["fee_kind"] | null,"staff_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"cancel_window_hours"?: number | null,"late_cancel_fee_amount"?: number | null,"late_cancel_fee_kind"?: Database["public"]['Enums']["fee_kind"] | null,"no_show_fee_amount"?: number | null,"no_show_fee_kind"?: Database["public"]['Enums']["fee_kind"] | null,"staff_id": string,"updated_at"?: string
                  }
                  Update: {
                    "business_id"?: string,"cancel_window_hours"?: number | null,"late_cancel_fee_amount"?: number | null,"late_cancel_fee_kind"?: Database["public"]['Enums']["fee_kind"] | null,"no_show_fee_amount"?: number | null,"no_show_fee_kind"?: Database["public"]['Enums']["fee_kind"] | null,"staff_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "staff_policies_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "staff_policies_staff_id_business_id_fkey"
      columns: ["staff_id","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"staff_schedule_overrides": {
                  Row: {
                    "business_id": string,"created_at": string,"end_minute": number,"id": string,"on_date": string,"staff_id": string,"start_minute": number
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"created_at"?: string,"end_minute": number,"id"?: string,"on_date": string,"staff_id": string,"start_minute": number
                  }
                  Update: {
                    "business_id"?: string,"created_at"?: string,"end_minute"?: number,"id"?: string,"on_date"?: string,"staff_id"?: string,"start_minute"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "staff_schedule_overrides_staff_id_business_id_fkey"
      columns: ["staff_id","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"staff_services": {
                  Row: {
                    "active_minutes": number | null,"business_id": string,"created_at": string,"finishing_minutes": number | null,"price_cents": number | null,"processing_minutes": number | null,"service_id": string,"staff_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "active_minutes"?: number | null,"business_id": string,"created_at"?: string,"finishing_minutes"?: number | null,"price_cents"?: number | null,"processing_minutes"?: number | null,"service_id": string,"staff_id": string,"updated_at"?: string
                  }
                  Update: {
                    "active_minutes"?: number | null,"business_id"?: string,"created_at"?: string,"finishing_minutes"?: number | null,"price_cents"?: number | null,"processing_minutes"?: number | null,"service_id"?: string,"staff_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "staff_services_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "staff_services_service_id_business_id_fkey"
      columns: ["service_id","business_id"]
isOneToOne: false
      referencedRelation: "services"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "staff_services_staff_id_business_id_fkey"
      columns: ["staff_id","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"staff_time_off": {
                  Row: {
                    "business_id": string,"created_at": string,"decided_at": string | null,"decided_by": string | null,"end_minute": number | null,"ends_on": string,"id": string,"note": string | null,"reason": Database["public"]['Enums']["time_off_reason"],"requested_by": string,"staff_id": string,"start_minute": number | null,"starts_on": string,"status": Database["public"]['Enums']["time_off_status"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"created_at"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"end_minute"?: number | null,"ends_on": string,"id"?: string,"note"?: string | null,"reason": Database["public"]['Enums']["time_off_reason"],"requested_by": string,"staff_id": string,"start_minute"?: number | null,"starts_on": string,"status"?: Database["public"]['Enums']["time_off_status"],"updated_at"?: string
                  }
                  Update: {
                    "business_id"?: string,"created_at"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"end_minute"?: number | null,"ends_on"?: string,"id"?: string,"note"?: string | null,"reason"?: Database["public"]['Enums']["time_off_reason"],"requested_by"?: string,"staff_id"?: string,"start_minute"?: number | null,"starts_on"?: string,"status"?: Database["public"]['Enums']["time_off_status"],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "staff_time_off_decided_by_business_id_fkey"
      columns: ["decided_by","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "staff_time_off_requested_by_business_id_fkey"
      columns: ["requested_by","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "staff_time_off_staff_id_business_id_fkey"
      columns: ["staff_id","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"staff_working_hours": {
                  Row: {
                    "business_id": string,"end_minute": number,"id": string,"staff_id": string,"start_minute": number,"weekday": number
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"end_minute": number,"id"?: string,"staff_id": string,"start_minute": number,"weekday": number
                  }
                  Update: {
                    "business_id"?: string,"end_minute"?: number,"id"?: string,"staff_id"?: string,"start_minute"?: number,"weekday"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "staff_working_hours_staff_id_business_id_fkey"
      columns: ["staff_id","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"stock_levels": {
                  Row: {
                    "business_id": string,"id": string,"location_id": string,"on_hand": number,"product_id": string,"reorder_point": number,"reorder_quantity": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"id"?: string,"location_id": string,"on_hand"?: number,"product_id": string,"reorder_point"?: number,"reorder_quantity"?: number,"updated_at"?: string
                  }
                  Update: {
                    "business_id"?: string,"id"?: string,"location_id"?: string,"on_hand"?: number,"product_id"?: string,"reorder_point"?: number,"reorder_quantity"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "stock_levels_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "stock_levels_location_id_business_id_fkey"
      columns: ["location_id","business_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "stock_levels_product_id_business_id_fkey"
      columns: ["product_id","business_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"stock_movements": {
                  Row: {
                    "appointment_id": string | null,"appointment_item_id": string | null,"business_id": string,"change": number,"created_at": string,"created_by": string | null,"id": string,"location_id": string,"note": string | null,"on_hand_after": number,"product_id": string,"purchase_order_id": string | null,"reason": Database["public"]['Enums']["stock_reason"],"stocktake_id": string | null,"unit_cost_cents": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "appointment_id"?: string | null,"appointment_item_id"?: string | null,"business_id": string,"change": number,"created_at"?: string,"created_by"?: string | null,"id"?: string,"location_id": string,"note"?: string | null,"on_hand_after": number,"product_id": string,"purchase_order_id"?: string | null,"reason": Database["public"]['Enums']["stock_reason"],"stocktake_id"?: string | null,"unit_cost_cents"?: number | null
                  }
                  Update: {
                    "appointment_id"?: string | null,"appointment_item_id"?: string | null,"business_id"?: string,"change"?: number,"created_at"?: string,"created_by"?: string | null,"id"?: string,"location_id"?: string,"note"?: string | null,"on_hand_after"?: number,"product_id"?: string,"purchase_order_id"?: string | null,"reason"?: Database["public"]['Enums']["stock_reason"],"stocktake_id"?: string | null,"unit_cost_cents"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "stock_movements_appointment_id_fkey"
      columns: ["appointment_id"]
isOneToOne: false
      referencedRelation: "appointments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "stock_movements_appointment_item_id_fkey"
      columns: ["appointment_item_id"]
isOneToOne: false
      referencedRelation: "appointment_items"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "stock_movements_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "stock_movements_created_by_business_id_fkey"
      columns: ["created_by","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "stock_movements_location_id_business_id_fkey"
      columns: ["location_id","business_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "stock_movements_product_id_business_id_fkey"
      columns: ["product_id","business_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "stock_movements_purchase_order_id_fkey"
      columns: ["purchase_order_id"]
isOneToOne: false
      referencedRelation: "purchase_orders"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "stock_movements_stocktake_id_fkey"
      columns: ["stocktake_id"]
isOneToOne: false
      referencedRelation: "stocktakes"
      referencedColumns: ["id"]
    }
                  ]
                },"stock_overrides": {
                  Row: {
                    "approved_by": string,"business_id": string,"created_at": string,"draft_id": string,"id": string,"product_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "approved_by": string,"business_id": string,"created_at"?: string,"draft_id": string,"id"?: string,"product_id": string
                  }
                  Update: {
                    "approved_by"?: string,"business_id"?: string,"created_at"?: string,"draft_id"?: string,"id"?: string,"product_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "stock_overrides_approved_by_business_id_fkey"
      columns: ["approved_by","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "stock_overrides_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "stock_overrides_draft_id_fkey"
      columns: ["draft_id"]
isOneToOne: false
      referencedRelation: "sale_drafts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "stock_overrides_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    }
                  ]
                },"stocktake_counts": {
                  Row: {
                    "business_id": string,"counted": number,"counted_at": string,"counted_by": string | null,"expected": number,"id": string,"product_id": string,"stocktake_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"counted": number,"counted_at"?: string,"counted_by"?: string | null,"expected": number,"id"?: string,"product_id": string,"stocktake_id": string
                  }
                  Update: {
                    "business_id"?: string,"counted"?: number,"counted_at"?: string,"counted_by"?: string | null,"expected"?: number,"id"?: string,"product_id"?: string,"stocktake_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "stocktake_counts_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "stocktake_counts_counted_by_business_id_fkey"
      columns: ["counted_by","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "stocktake_counts_product_id_business_id_fkey"
      columns: ["product_id","business_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "stocktake_counts_stocktake_id_business_id_fkey"
      columns: ["stocktake_id","business_id"]
isOneToOne: false
      referencedRelation: "stocktakes"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"stocktakes": {
                  Row: {
                    "business_id": string,"finished_at": string | null,"finished_by": string | null,"id": string,"location_id": string,"started_at": string,"started_by": string | null,"status": Database["public"]['Enums']["stocktake_status"]
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"finished_at"?: string | null,"finished_by"?: string | null,"id"?: string,"location_id": string,"started_at"?: string,"started_by"?: string | null,"status"?: Database["public"]['Enums']["stocktake_status"]
                  }
                  Update: {
                    "business_id"?: string,"finished_at"?: string | null,"finished_by"?: string | null,"id"?: string,"location_id"?: string,"started_at"?: string,"started_by"?: string | null,"status"?: Database["public"]['Enums']["stocktake_status"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "stocktakes_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "stocktakes_finished_by_business_id_fkey"
      columns: ["finished_by","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "stocktakes_location_id_business_id_fkey"
      columns: ["location_id","business_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "stocktakes_started_by_business_id_fkey"
      columns: ["started_by","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"suppliers": {
                  Row: {
                    "account_number": string | null,"business_id": string,"created_at": string,"email": string | null,"id": string,"is_active": boolean,"lead_time_days": number,"name": string,"notes": string | null,"phone": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_number"?: string | null,"business_id": string,"created_at"?: string,"email"?: string | null,"id"?: string,"is_active"?: boolean,"lead_time_days"?: number,"name": string,"notes"?: string | null,"phone"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "account_number"?: string | null,"business_id"?: string,"created_at"?: string,"email"?: string | null,"id"?: string,"is_active"?: boolean,"lead_time_days"?: number,"name"?: string,"notes"?: string | null,"phone"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "suppliers_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    }
                  ]
                },"time_block_skips": {
                  Row: {
                    "block_id": string,"business_id": string,"on_date": string
                  }
                  ComputedFields: never
                  Insert: {
                    "block_id": string,"business_id": string,"on_date": string
                  }
                  Update: {
                    "block_id"?: string,"business_id"?: string,"on_date"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "time_block_skips_block_id_business_id_fkey"
      columns: ["block_id","business_id"]
isOneToOne: false
      referencedRelation: "time_blocks"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"time_blocks": {
                  Row: {
                    "business_id": string,"created_at": string,"created_by": string | null,"end_minute": number,"ends_on": string | null,"event_id": string | null,"id": string,"kind": Database["public"]['Enums']["time_block_kind"],"location_id": string,"note": string | null,"on_date": string | null,"repeat_weekdays": (number)[] | null,"staff_id": string,"start_minute": number,"starts_on": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"created_at"?: string,"created_by"?: string | null,"end_minute": number,"ends_on"?: string | null,"event_id"?: string | null,"id"?: string,"kind": Database["public"]['Enums']["time_block_kind"],"location_id": string,"note"?: string | null,"on_date"?: string | null,"repeat_weekdays"?: (number)[] | null,"staff_id": string,"start_minute": number,"starts_on"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "business_id"?: string,"created_at"?: string,"created_by"?: string | null,"end_minute"?: number,"ends_on"?: string | null,"event_id"?: string | null,"id"?: string,"kind"?: Database["public"]['Enums']["time_block_kind"],"location_id"?: string,"note"?: string | null,"on_date"?: string | null,"repeat_weekdays"?: (number)[] | null,"staff_id"?: string,"start_minute"?: number,"starts_on"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "time_blocks_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "time_blocks_created_by_business_id_fkey"
      columns: ["created_by","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "time_blocks_event_fk"
      columns: ["event_id","business_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "time_blocks_location_id_business_id_fkey"
      columns: ["location_id","business_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "time_blocks_staff_id_business_id_fkey"
      columns: ["staff_id","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"visit_photos": {
                  Row: {
                    "appointment_id": string,"business_id": string,"client_id": string,"created_at": string,"created_by": string | null,"id": string,"kind": string,"marketing_marked_at": string | null,"marketing_marked_by": string | null,"marketing_ok": boolean,"staff_id": string | null,"storage_path": string
                  }
                  ComputedFields: never
                  Insert: {
                    "appointment_id": string,"business_id": string,"client_id": string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"kind": string,"marketing_marked_at"?: string | null,"marketing_marked_by"?: string | null,"marketing_ok"?: boolean,"staff_id"?: string | null,"storage_path": string
                  }
                  Update: {
                    "appointment_id"?: string,"business_id"?: string,"client_id"?: string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"kind"?: string,"marketing_marked_at"?: string | null,"marketing_marked_by"?: string | null,"marketing_ok"?: boolean,"staff_id"?: string | null,"storage_path"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "visit_photos_appointment_id_fkey"
      columns: ["appointment_id"]
isOneToOne: false
      referencedRelation: "appointments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "visit_photos_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "visit_photos_client_id_fkey"
      columns: ["client_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "visit_photos_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "visit_photos_marketing_marked_by_fkey"
      columns: ["marketing_marked_by"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "visit_photos_staff_id_fkey"
      columns: ["staff_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id"]
    }
                  ]
                },"waitlist_entries": {
                  Row: {
                    "appointment_id": string | null,"business_id": string,"client_id": string,"created_at": string,"created_by": string | null,"from_date": string,"id": string,"location_id": string,"notes": string | null,"service_ids": (string)[],"staff_ids": (string)[],"status": Database["public"]['Enums']["waitlist_status"],"to_date": string,"updated_at": string,"windows": (string)[]
                  }
                  ComputedFields: never
                  Insert: {
                    "appointment_id"?: string | null,"business_id": string,"client_id": string,"created_at"?: string,"created_by"?: string | null,"from_date": string,"id"?: string,"location_id": string,"notes"?: string | null,"service_ids": (string)[],"staff_ids"?: (string)[],"status"?: Database["public"]['Enums']["waitlist_status"],"to_date": string,"updated_at"?: string,"windows"?: (string)[]
                  }
                  Update: {
                    "appointment_id"?: string | null,"business_id"?: string,"client_id"?: string,"created_at"?: string,"created_by"?: string | null,"from_date"?: string,"id"?: string,"location_id"?: string,"notes"?: string | null,"service_ids"?: (string)[],"staff_ids"?: (string)[],"status"?: Database["public"]['Enums']["waitlist_status"],"to_date"?: string,"updated_at"?: string,"windows"?: (string)[]
                  }
                  Relationships: [
                    {
      foreignKeyName: "waitlist_entries_appointment_id_business_id_location_id_fkey"
      columns: ["appointment_id","business_id","location_id"]
isOneToOne: false
      referencedRelation: "appointments"
      referencedColumns: ["id","business_id","location_id"]
    },{
      foreignKeyName: "waitlist_entries_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "waitlist_entries_client_id_business_id_fkey"
      columns: ["client_id","business_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "waitlist_entries_created_by_business_id_fkey"
      columns: ["created_by","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "waitlist_entries_location_id_business_id_fkey"
      columns: ["location_id","business_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id","business_id"]
    }
                  ]
                },"walk_ins": {
                  Row: {
                    "appointment_id": string | null,"arrived_at": string,"business_id": string,"client_id": string | null,"created_by": string | null,"id": string,"location_id": string,"name": string,"phone": string | null,"service_id": string,"status": Database["public"]['Enums']["walk_in_status"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "appointment_id"?: string | null,"arrived_at"?: string,"business_id": string,"client_id"?: string | null,"created_by"?: string | null,"id"?: string,"location_id": string,"name": string,"phone"?: string | null,"service_id": string,"status"?: Database["public"]['Enums']["walk_in_status"],"updated_at"?: string
                  }
                  Update: {
                    "appointment_id"?: string | null,"arrived_at"?: string,"business_id"?: string,"client_id"?: string | null,"created_by"?: string | null,"id"?: string,"location_id"?: string,"name"?: string,"phone"?: string | null,"service_id"?: string,"status"?: Database["public"]['Enums']["walk_in_status"],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "walk_ins_appointment_id_business_id_location_id_fkey"
      columns: ["appointment_id","business_id","location_id"]
isOneToOne: false
      referencedRelation: "appointments"
      referencedColumns: ["id","business_id","location_id"]
    },{
      foreignKeyName: "walk_ins_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "walk_ins_client_id_business_id_fkey"
      columns: ["client_id","business_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "walk_ins_created_by_business_id_fkey"
      columns: ["created_by","business_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "walk_ins_location_id_business_id_fkey"
      columns: ["location_id","business_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id","business_id"]
    },{
      foreignKeyName: "walk_ins_service_id_business_id_fkey"
      columns: ["service_id","business_id"]
isOneToOne: false
      referencedRelation: "services"
      referencedColumns: ["id","business_id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "accept_event_proposal":
{ Args: { "p_input": Json,"p_link_id": string }; Returns: undefined
                           },
"add_event_photo":
{ Args: { "p_event_id": string,"p_path": string }; Returns: string
                           },
"add_formula":
{ Args: { "p_appointment_item_id": string,"p_client_id": string,"p_formula": string,"p_lines": Json,"p_notes": string,"p_visit_date": string }; Returns: string
                           },
"add_inquiry_photos":
{ Args: { "p_event_id": string,"p_paths": (string)[] }; Returns: undefined
                           },
"add_visit_photo":
{ Args: { "p_appointment_id": string,"p_kind": string,"p_path": string }; Returns: string
                           },
"adjust_gift_card":
{ Args: { "p_card_id": string,"p_change_cents": number,"p_reason": string }; Returns: number
                           },
"adjust_stock":
{ Args: { "p_change": number,"p_location_id": string,"p_note": string,"p_product_id": string,"p_reason": Database["public"]['Enums']["stock_reason"] }; Returns: number
                           },
"advance_membership":
{ Args: { "p_membership_id": string,"p_today": string }; Returns: Json
                           },
"ai_usage_today":
{ Args: { "p_business_id": string }; Returns: {
              "daily_limit": number,"used": number
            }[]
                           },
"apply_ai_action":
{ Args: { "p_action_id": string,"p_client_id"?: string,"p_expected_version": number }; Returns: undefined
                           },
"apply_automation_action":
{ Args: { "p_action_id": string }; Returns: undefined
                           },
"apply_duration_action":
{ Args: { "p_action_id": string }; Returns: undefined
                           },
"apply_reorder_draft":
{ Args: { "p_action_id": string }; Returns: string
                           },
"approve_stock_override":
{ Args: { "p_draft_id": string,"p_product_id": string }; Returns: undefined
                           },
"archive_commission_plan":
{ Args: { "p_plan_id": string }; Returns: undefined
                           },
"archive_promotion":
{ Args: { "p_promotion_id": string }; Returns: undefined
                           },
"attach_online_promotion":
{ Args: { "p_appointment_id": string,"p_promotion_id": string }; Returns: undefined
                           },
"best_sellers":
{ Args: { "p_location_id": string,"p_since": string }; Returns: {
              "product_id": string,"quantity": number,"staff_id": string
            }[]
                           },
"cancel_membership":
{ Args: { "p_membership_id": string,"p_now": boolean,"p_reason": string }; Returns: string
                           },
"cancel_online_appointment":
{ Args: { "p_appointment_id": string,"p_manage_token_hash": string }; Returns: undefined
                           },
"cancel_package":
{ Args: { "p_client_package_id": string,"p_reason": string,"p_refund_method": string }; Returns: number
                           },
"cancel_payment_link":
{ Args: { "p_link_id": string }; Returns: undefined
                           },
"cancel_stocktake":
{ Args: { "p_stocktake_id": string }; Returns: undefined
                           },
"check_in_patch_override":
{ Args: { "p_appointment_id": string,"p_reason": string }; Returns: undefined
                           },
"check_staff_pin":
{ Args: { "p_pin": string,"p_staff_id": string,"p_token_hash": string }; Returns: Json
                           },
"claim_event_payments":
{ Args: { "p_business_id": string,"p_limit": number,"p_payment_id": string }; Returns: {
              "amount_cents": number,"attempt": number,"business_id": string,"card_label": string,"event_id": string,"kind": string,"payment_id": string,"payment_method_ref": string,"provider": string
            }[]
                           },
"claim_online_booking_attempt":
{ Args: { "p_business_id": string,"p_key_hash": string }; Returns: string
                           },
"claim_policy_fees":
{ Args: { "p_business_id": string,"p_fee_id": string,"p_limit": number }; Returns: {
              "amount_cents": number,"appointment_id": string,"attempt": number,"business_id": string,"card_label": string,"client_id": string,"fee_id": string,"kind": string,"payment_method_ref": string,"provider": string
            }[]
                           },
"clear_count":
{ Args: { "p_product_id": string,"p_stocktake_id": string }; Returns: undefined
                           },
"clear_staff_pin":
{ Args: { "p_staff_id": string }; Returns: undefined
                           },
"client_policy_standing":
{ Args: { "p_client_id": string }; Returns: Json
                           },
"commission_rules":
{ Args: { "p_business_id": string,"p_staff_id"?: string }; Returns: Json
                           },
"complete_card_request":
{ Args: { "p_card": Json,"p_consent": Json,"p_deposit": Json,"p_request_id": string }; Returns: undefined
                           },
"complete_event":
{ Args: { "p_event_id": string }; Returns: string
                           },
"complete_payment_link":
{ Args: { "p_link_id": string,"p_provider": string,"p_reference": string,"p_tips": Json,"p_total_cents": number }; Returns: string
                           },
"complete_sale":
{ Args: { "p_input": Json,"p_location_id": string }; Returns: string
                           },
"configure_scheduled_jobs":
{ Args: { "p_app_url": string,"p_secret": string }; Returns: undefined
                           },
"create_card_request":
{ Args: { "p_appointment_id": string,"p_channel": string,"p_client_id": string,"p_deposit_cents": number,"p_hours": number,"p_to": string,"p_token_hash": string }; Returns: string
                           },
"create_payment_link":
{ Args: { "p_amount_cents": number,"p_channel": string,"p_draft_id": string,"p_hours": number,"p_snapshot": Json,"p_to": string,"p_token_hash": string }; Returns: string
                           },
"delete_calendar_view":
{ Args: { "p_view_id": string }; Returns: undefined
                           },
"delete_purchase_order":
{ Args: { "p_order_id": string }; Returns: undefined
                           },
"delete_staff_goal":
{ Args: { "p_goal_id": string }; Returns: undefined
                           },
"delete_visit_photo":
{ Args: { "p_photo_id": string }; Returns: string
                           },
"dismiss_denise_item":
{ Args: { "p_day": string,"p_key": string,"p_location_id": string }; Returns: undefined
                           },
"event_member_prices":
{ Args: { "p_event_ids": (string)[] }; Returns: {
              "event_id": string,"member_id": string,"price_cents": number
            }[]
                           },
"event_money":
{ Args: { "p_event_ids": (string)[] }; Returns: {
              "deposit_cents": number,"early_fee_cents": number,"event_id": string,"main_cents": number,"service_charge_cents": number,"subtotal_cents": number,"tax_cents": number,"total_cents": number,"travel_fee_cents": number
            }[]
                           },
"find_online_client":
{ Args: { "p_business_id": string,"p_email": string,"p_first_name": string,"p_last_name": string,"p_phone": string,"p_phone_digits": string }; Returns: string
                           },
"finish_online_booking_attempt":
{ Args: { "p_appointment_id": string,"p_business_id": string,"p_key_hash": string }; Returns: undefined
                           },
"finish_stocktake":
{ Args: { "p_stocktake_id": string }; Returns: number
                           },
"goal_progress":
{ Args: { "p_from": string,"p_staff_id": string,"p_to": string }; Returns: Json
                           },
"hit_rate_limit":
{ Args: { "p_key": string,"p_limit": number,"p_window_seconds": number }; Returns: boolean
                           },
"import_gift_card":
{ Args: { "p_balance_cents": number,"p_business_id": string,"p_client_id": string,"p_code": string,"p_expires_at": string,"p_initial_cents": number,"p_issued_at": string }; Returns: string
                           },
"issue_promo_card":
{ Args: { "p_amount_cents": number,"p_client_id": string,"p_expires_in_days": number,"p_reason": string,"p_recipient_email": string,"p_recipient_name": string }; Returns: string
                           },
"keep_membership":
{ Args: { "p_membership_id": string }; Returns: undefined
                           },
"link_event_trial":
{ Args: { "p_appointment_id": string,"p_event_id": string }; Returns: undefined
                           },
"log_data_export":
{ Args: { "p_business_id": string,"p_bytes": number,"p_row_counts": Json }; Returns: string
                           },
"log_receipt_email":
{ Args: { "p_email": string,"p_sale_id": string }; Returns: undefined
                           },
"lookup_gift_card":
{ Args: { "p_code": string }; Returns: Json
                           },
"marketing_opt_out":
{ Args: { "p_token_hash": string }; Returns: Json
                           },
"move_time_block":
{ Args: { "p_block_id": string,"p_end": number,"p_on_date": string,"p_start": number }; Returns: string
                           },
"my_permissions":
{ Args: { "p_business_id": string }; Returns: (string)[]
                           },
"pause_membership":
{ Args: { "p_membership_id": string,"p_periods": number }; Returns: undefined
                           },
"pay_event_member":
{ Args: { "p_link_id": string,"p_payment": Json }; Returns: undefined
                           },
"payroll_sales":
{ Args: { "p_business_id": string,"p_from": string,"p_staff_id"?: string,"p_to": string }; Returns: Json
                           },
"product_costs":
{ Args: Record<PropertyKey, never>; Returns: {
              "cost_cents": number,"product_id": string
            }[]
                           },
"receive_purchase_order":
{ Args: { "p_lines": Json,"p_order_id": string }; Returns: Database["public"]['Enums']["purchase_order_status"]
                           },
"recent_offer_clients":
{ Args: { "p_business_id": string,"p_client_ids": (string)[] }; Returns: string[]
                           },
"record_ai_proposals":
{ Args: { "p_feature": string,"p_location_id": string,"p_options": Json,"p_subject": string }; Returns: (string)[]
                           },
"record_ai_proposals_as_system":
{ Args: { "p_feature": string,"p_location_id": string,"p_options": Json,"p_subject": string }; Returns: (string)[]
                           },
"record_ai_proposals_for_user":
{ Args: { "p_feature": string,"p_location_id": string,"p_options": Json,"p_subject": string,"p_user_id": string }; Returns: (string)[]
                           },
"record_ai_usage":
{ Args: { "p_business_id": string,"p_cache_read": number,"p_feature": string,"p_input": number,"p_model": string,"p_output": number }; Returns: undefined
                           },
"record_count":
{ Args: { "p_counted": number,"p_product_id": string,"p_stocktake_id": string }; Returns: number
                           },
"record_deposit_refund":
{ Args: { "p_appointment_id": string,"p_ok": boolean }; Returns: undefined
                           },
"record_event_charge":
{ Args: { "p_attempt": number,"p_payment_id": string,"p_result": Json }; Returns: string
                           },
"record_fee_charge":
{ Args: { "p_attempt": number,"p_fee_id": string,"p_result": Json }; Returns: string
                           },
"record_fee_receipt":
{ Args: { "p_fee_id": string }; Returns: undefined
                           },
"record_fee_refund":
{ Args: { "p_detail": string,"p_fee_id": string,"p_ok": boolean }; Returns: undefined
                           },
"record_item_time":
{ Args: { "p_event": string,"p_item_id": string }; Returns: undefined
                           },
"record_membership_charge":
{ Args: { "p_membership_id": string,"p_result": Json,"p_today": string }; Returns: Json
                           },
"record_online_card":
{ Args: { "p_appointment_id": string,"p_card": Json,"p_consent": Json,"p_deposit": Json }; Returns: undefined
                           },
"record_provider_refund":
{ Args: { "p_ok": boolean,"p_payment_id": string }; Returns: undefined
                           },
"record_visit_notices_for_user":
{ Args: { "p_appointment_id": string,"p_notices": Json,"p_user_id": string }; Returns: number
                           },
"refund_sale":
{ Args: { "p_input": Json,"p_sale_id": string }; Returns: undefined
                           },
"refundable_lines":
{ Args: { "p_sale_id": string }; Returns: {
              "description": string,"kind": string,"sale_item_id": string,"value_cents": number
            }[]
                           },
"register_shared_device":
{ Args: { "p_location_id": string,"p_name": string,"p_token_hash": string }; Returns: string
                           },
"reject_ai_action":
{ Args: { "p_action_id": string }; Returns: undefined
                           },
"release_event_staff":
{ Args: { "p_event_id": string,"p_staff_ids": (string)[] }; Returns: undefined
                           },
"remove_client_card":
{ Args: { "p_client_id": string }; Returns: undefined
                           },
"remove_own_card":
{ Args: { "p_business_id": string,"p_client_id": string }; Returns: undefined
                           },
"report_call_out":
{ Args: { "p_from": string,"p_staff_id": string }; Returns: string
                           },
"report_running_late":
{ Args: { "p_item_id": string,"p_minutes": number }; Returns: string
                           },
"resume_membership":
{ Args: { "p_membership_id": string }; Returns: undefined
                           },
"retry_event_payment":
{ Args: { "p_payment_id": string }; Returns: undefined
                           },
"retry_membership_payment":
{ Args: { "p_membership_id": string }; Returns: undefined
                           },
"retry_policy_fee":
{ Args: { "p_fee_id": string }; Returns: undefined
                           },
"revoke_shared_device":
{ Args: { "p_device_id": string }; Returns: undefined
                           },
"run_scheduled_job_now":
{ Args: { "p_path": string }; Returns: number
                           },
"save_appointment":
{ Args: { "p_appointment_id": string,"p_client_id": string,"p_expected_version": number,"p_items": Json,"p_location_id": string,"p_notes": string }; Returns: string
                           },
"save_automation":
{ Args: { "p_business_id": string,"p_input": Json,"p_kind": string }; Returns: undefined
                           },
"save_calendar_view":
{ Args: { "p_location_id": string,"p_name": string,"p_shared": boolean,"p_staff_ids": (string)[],"p_view_id": string }; Returns: string
                           },
"save_closeout":
{ Args: { "p_counted_cents": number,"p_day": string,"p_float_cents"?: number,"p_location_id": string,"p_note": string }; Returns: number
                           },
"save_commission_plan":
{ Args: { "p_business_id": string,"p_default": boolean,"p_name": string,"p_plan_id": string,"p_rules": Json }; Returns: string
                           },
"save_event":
{ Args: { "p_event_id": string,"p_input": Json }; Returns: string
                           },
"save_event_inquiry":
{ Args: { "p_business_id": string,"p_input": Json }; Returns: string
                           },
"save_event_look":
{ Args: { "p_event_id": string,"p_notes": string }; Returns: undefined
                           },
"save_event_package":
{ Args: { "p_input": Json,"p_package_id": string }; Returns: string
                           },
"save_event_settings":
{ Args: { "p_input": Json }; Returns: undefined
                           },
"save_membership_plan":
{ Args: { "p_business_id": string,"p_input": Json,"p_plan_id": string }; Returns: string
                           },
"save_online_appointment":
{ Args: { "p_appointment_id": string,"p_client_id": string,"p_expected_version": number,"p_items": Json,"p_location_id": string,"p_manage_token_hash": string,"p_notes": string,"p_source"?: string }; Returns: string
                           },
"save_package_template":
{ Args: { "p_input": Json,"p_template_id": string }; Returns: string
                           },
"save_policy_settings":
{ Args: { "p": Json,"p_business_id": string }; Returns: undefined
                           },
"save_promotion":
{ Args: { "p_business_id": string,"p_input": Json,"p_promotion_id": string }; Returns: string
                           },
"save_purchase_order":
{ Args: { "p_lines": Json,"p_location_id": string,"p_notes": string,"p_order_id": string,"p_supplier_id": string }; Returns: string
                           },
"save_service":
{ Args: { "p_active_minutes": number,"p_business_id": string,"p_category": string,"p_description": string,"p_finishing_minutes": number,"p_name": string,"p_price_cents": number,"p_processing_minutes": number,"p_service_id": string,"p_staff": Json }; Returns: string
                           },
"save_staff_goal":
{ Args: { "p_metric": string,"p_period": string,"p_staff_id": string,"p_target": number }; Returns: string
                           },
"save_staff_policy":
{ Args: { "p": Json,"p_staff_id": string }; Returns: undefined
                           },
"save_team_member":
{ Args: { "p_business_id": string,"p_input": Json,"p_location_id": string,"p_staff_id": string }; Returns: string
                           },
"scheduled_jobs_status":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"seen_goal_alert":
{ Args: { "p_milestones": Json,"p_on": string }; Returns: undefined
                           },
"send_client_message":
{ Args: { "p_appointment_id": string,"p_body": string,"p_channel": string,"p_opt_out_hash"?: string,"p_purpose": string,"p_subject": string,"p_template": string }; Returns: string
                           },
"send_event_card_link":
{ Args: { "p_channel": string,"p_days": number,"p_event_id": string,"p_to": string,"p_token_hash": string }; Returns: string
                           },
"send_event_member_link":
{ Args: { "p_channel": string,"p_days": number,"p_member_id": string,"p_to": string,"p_token_hash": string }; Returns: string
                           },
"send_event_proposal":
{ Args: { "p_channel": string,"p_days": number,"p_event_id": string,"p_to": string,"p_token_hash": string }; Returns: string
                           },
"send_promotion_message":
{ Args: { "p_body": string,"p_channel": string,"p_client_id": string,"p_opt_out_hash": string,"p_promotion_id": string,"p_subject": string,"p_template": string }; Returns: string
                           },
"send_purchase_order":
{ Args: { "p_order_id": string }; Returns: undefined
                           },
"set_appointment_group":
{ Args: { "p_appointment_id": string,"p_group_id": string }; Returns: undefined
                           },
"set_appointment_notes":
{ Args: { "p_appointment_id": string,"p_notes": string }; Returns: undefined
                           },
"set_appointment_series":
{ Args: { "p_appointment_id": string,"p_index": number,"p_series_id": string }; Returns: undefined
                           },
"set_appointment_status":
{ Args: { "p_appointment_id": string,"p_reason": string,"p_status": Database["public"]['Enums']["appointment_status"] }; Returns: undefined
                           },
"set_assistant_stylist":
{ Args: { "p_staff_id": string,"p_stylist_id": string }; Returns: undefined
                           },
"set_auto_lock":
{ Args: { "p_business_id": string,"p_minutes": number }; Returns: undefined
                           },
"set_calendar_order":
{ Args: { "p_business_id": string,"p_staff_ids": (string)[] }; Returns: undefined
                           },
"set_calendar_zoom":
{ Args: { "p_zoom": string }; Returns: undefined
                           },
"set_checkout_settings":
{ Args: { "p_business_id": string,"p_settings": Json }; Returns: undefined
                           },
"set_client_consent":
{ Args: { "p_changes": Json,"p_client_id": string,"p_detail"?: string,"p_source": string }; Returns: undefined
                           },
"set_event_status":
{ Args: { "p_event_id": string,"p_reason": string,"p_status": Database["public"]['Enums']["event_status"] }; Returns: undefined
                           },
"set_free_text_roles":
{ Args: { "p_business_id": string,"p_roles": (string)[] }; Returns: undefined
                           },
"set_gift_card_settings":
{ Args: { "p_business_id": string,"p_expiry_months": number,"p_presets": (number)[],"p_promo_days": number }; Returns: undefined
                           },
"set_goal_alerts":
{ Args: { "p_frequency": string }; Returns: undefined
                           },
"set_location_hours":
{ Args: { "p_business_id": string,"p_hours": Json,"p_location_id": string }; Returns: undefined
                           },
"set_my_pin":
{ Args: { "p_business_id": string,"p_pin": string }; Returns: undefined
                           },
"set_payroll_settings":
{ Args: { "p_anchor": string,"p_business_id": string,"p_pay_period": string }; Returns: undefined
                           },
"set_photo_consent":
{ Args: { "p_client_id": string,"p_on": string }; Returns: undefined
                           },
"set_photo_marketing":
{ Args: { "p_ok": boolean,"p_photo_id": string }; Returns: undefined
                           },
"set_service_level_prices":
{ Args: { "p_prices": Json,"p_service_id": string }; Returns: undefined
                           },
"set_service_recipe":
{ Args: { "p_lines": Json,"p_service_id": string }; Returns: undefined
                           },
"set_staff_active":
{ Args: { "p_active": boolean,"p_staff_id": string }; Returns: undefined
                           },
"set_staff_commission_plan":
{ Args: { "p_plan_id": string,"p_staff_id": string }; Returns: undefined
                           },
"set_staff_day_override":
{ Args: { "p_business_id": string,"p_hours": Json,"p_on_date": string,"p_staff_id": string }; Returns: undefined
                           },
"set_staff_event_roles":
{ Args: { "p_roles": (string)[],"p_staff_id": string }; Returns: undefined
                           },
"set_staff_permission":
{ Args: { "p_allowed": boolean,"p_permission": string,"p_staff_id": string }; Returns: undefined
                           },
"set_staff_weekly_hours":
{ Args: { "p_business_id": string,"p_hours": Json,"p_staff_id": string }; Returns: undefined
                           },
"set_stock_settings":
{ Args: { "p_location_id": string,"p_product_id": string,"p_reorder_point": number,"p_reorder_quantity": number }; Returns: undefined
                           },
"shared_device":
{ Args: { "p_token_hash": string }; Returns: Json
                           },
"sms_keyword":
{ Args: { "p_body": string,"p_phone_digits": string }; Returns: string
                           },
"staff_permission_list":
{ Args: { "p_staff_id": string }; Returns: {
              "allowed": boolean,"permission": string,"role_default": boolean,"toggleable": boolean
            }[]
                           },
"staff_with_pins":
{ Args: { "p_business_id": string }; Returns: string[]
                           },
"start_stocktake":
{ Args: { "p_location_id": string }; Returns: string
                           },
"team_logins":
{ Args: { "p_business_id": string }; Returns: {
              "email": string,"invited_at": string,"last_sign_in_at": string,"staff_id": string
            }[]
                           },
"undo_ai_action":
{ Args: { "p_action_id": string,"p_expected_version": number }; Returns: undefined
                           },
"undo_automation_action":
{ Args: { "p_action_id": string }; Returns: undefined
                           },
"undo_check_in":
{ Args: { "p_appointment_id": string }; Returns: undefined
                           },
"undo_duration_action":
{ Args: { "p_action_id": string }; Returns: undefined
                           },
"undo_no_show":
{ Args: { "p_appointment_id": string,"p_expected_version": number }; Returns: undefined
                           },
"undo_reorder_draft":
{ Args: { "p_action_id": string }; Returns: undefined
                           },
"update_event_card":
{ Args: { "p_card": Json,"p_link_id": string }; Returns: undefined
                           },
"update_membership_card":
{ Args: { "p_label": string,"p_membership_id": string,"p_provider": string,"p_ref": string }; Returns: undefined
                           },
"void_gift_card":
{ Args: { "p_card_id": string,"p_reason": string }; Returns: undefined
                           },
"void_sale":
{ Args: { "p_reason": string,"p_sale_id": string }; Returns: undefined
                           },
"waive_policy_fee":
{ Args: { "p_fee_id": string,"p_reason": string }; Returns: Json
                           }
          }
          Enums: {
            "ai_action_status": "proposed"|"approved"|"rejected"|"undone","appointment_source": "front_desk"|"phone"|"online"|"walk_in"|"import","appointment_status": "booked"|"confirmed"|"checked_in"|"completed"|"canceled"|"no_show","client_package_status": "active"|"canceled"|"refunded","deposit_kind": "none"|"fixed"|"percent","disruption_kind": "overrun"|"client_late"|"call_out","event_party_role": "bride"|"bridesmaid"|"maid_of_honor"|"mother"|"flower_girl"|"groom"|"guest","event_status": "inquiry"|"proposal_sent"|"booked"|"trial_done"|"completed"|"lost","fee_kind": "none"|"fixed"|"percent"|"deposit","form_requirement": "none"|"first_visit"|"services","gift_card_kind": "purchased"|"promotional","gift_card_status": "active"|"voided","membership_status": "active"|"past_due"|"paused"|"canceled","notification_status": "pending"|"sent"|"canceled","online_service_mode": "bookable"|"consultation"|"off","patch_test_result": "no_reaction"|"reaction","payment_method": "cash"|"card"|"gift_card"|"package"|"membership","product_type": "retail"|"back_bar","product_unit": "g"|"ml"|"unit","purchase_order_status": "draft"|"sent"|"partly_received"|"received","resource_kind": "chair"|"room"|"station","sale_item_kind": "service"|"product"|"gift_card"|"gift_card_reload"|"package"|"membership","sale_status": "completed"|"partly_refunded"|"refunded"|"voided","staff_level": "artisan"|"senior"|"master","staff_role": "owner"|"manager"|"front_desk"|"stylist"|"assistant","stock_reason": "service_use"|"sale"|"count"|"order_received"|"adjustment","stocktake_status": "in_progress"|"completed"|"canceled","time_block_kind": "lunch"|"break"|"training"|"meeting"|"personal"|"event","time_off_reason": "vacation"|"sick"|"personal"|"other","time_off_status": "requested"|"approved"|"declined","waitlist_status": "waiting"|"booked"|"removed","walk_in_status": "waiting"|"booked"|"left"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            "ai_action_status": ["proposed", "approved", "rejected", "undone"],"appointment_source": ["front_desk", "phone", "online", "walk_in", "import"],"appointment_status": ["booked", "confirmed", "checked_in", "completed", "canceled", "no_show"],"client_package_status": ["active", "canceled", "refunded"],"deposit_kind": ["none", "fixed", "percent"],"disruption_kind": ["overrun", "client_late", "call_out"],"event_party_role": ["bride", "bridesmaid", "maid_of_honor", "mother", "flower_girl", "groom", "guest"],"event_status": ["inquiry", "proposal_sent", "booked", "trial_done", "completed", "lost"],"fee_kind": ["none", "fixed", "percent", "deposit"],"form_requirement": ["none", "first_visit", "services"],"gift_card_kind": ["purchased", "promotional"],"gift_card_status": ["active", "voided"],"membership_status": ["active", "past_due", "paused", "canceled"],"notification_status": ["pending", "sent", "canceled"],"online_service_mode": ["bookable", "consultation", "off"],"patch_test_result": ["no_reaction", "reaction"],"payment_method": ["cash", "card", "gift_card", "package", "membership"],"product_type": ["retail", "back_bar"],"product_unit": ["g", "ml", "unit"],"purchase_order_status": ["draft", "sent", "partly_received", "received"],"resource_kind": ["chair", "room", "station"],"sale_item_kind": ["service", "product", "gift_card", "gift_card_reload", "package", "membership"],"sale_status": ["completed", "partly_refunded", "refunded", "voided"],"staff_level": ["artisan", "senior", "master"],"staff_role": ["owner", "manager", "front_desk", "stylist", "assistant"],"stock_reason": ["service_use", "sale", "count", "order_received", "adjustment"],"stocktake_status": ["in_progress", "completed", "canceled"],"time_block_kind": ["lunch", "break", "training", "meeting", "personal", "event"],"time_off_reason": ["vacation", "sick", "personal", "other"],"time_off_status": ["requested", "approved", "declined"],"waitlist_status": ["waiting", "booked", "removed"],"walk_in_status": ["waiting", "booked", "left"]
          }
        }
} as const
